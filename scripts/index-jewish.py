"""Build complete local semantic indexes for the expanded libraries.
Long segments are embedded in overlapping chunks and pooled; no tail of a segment
is silently discarded. References remain the original edition's segment addresses.
"""


def require(condition, message='Import validation failed'):
    if not condition:
        raise ValueError(message)

import argparse,hashlib,importlib.metadata,json,os,sqlite3,tempfile,time
from pathlib import Path
os.environ.setdefault('OMP_NUM_THREADS','2');os.environ.setdefault('OPENBLAS_NUM_THREADS','1');os.environ.setdefault('TOKENIZERS_PARALLELISM','false');os.environ.setdefault('HF_HUB_DISABLE_TELEMETRY','1');os.environ.setdefault('HF_HUB_OFFLINE','1')
ROOT=Path(__file__).resolve().parent.parent;DATA=ROOT/'data';MODEL='intfloat/multilingual-e5-small';CACHE=DATA/'torah-models'

def main():
    import numpy as np
    from search_chunks import load_tokenizer,passage_chunks
    chunk_tokenizer=load_tokenizer(CACHE)
    import importlib.util
    spec=importlib.util.spec_from_file_location('text_importer',ROOT/'scripts/import-jewish.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('libraries',nargs='*',choices=['bavli','yerushalmi','mishnah','midrash','zohar','shulchan']);parser.add_argument('--workers',type=int,default=8);parser.add_argument('--cuda',action='store_true');args=parser.parse_args()
    if not args.libraries:args.libraries=['bavli','yerushalmi','mishnah','midrash','zohar','shulchan']
    if args.cuda:
        import torch
        from transformers import AutoTokenizer,AutoModel
        torch.set_num_threads(4)
        revision='614241f622f53c4eeff9890bdc4f31cfecc418b3'
        model_dir=DATA/'jewish-torch-model'
        # Only this one-time index build uses CUDA. App queries keep the existing CPU runtime.
        os.environ.pop('HF_HUB_OFFLINE',None)
        tokenizer=AutoTokenizer.from_pretrained(MODEL,revision=revision,cache_dir=model_dir,trust_remote_code=False)
        model=AutoModel.from_pretrained(MODEL,revision=revision,cache_dir=model_dir,trust_remote_code=False,dtype=torch.float16).to('cuda').eval()
        def embed(chunks):
            for start in range(0,len(chunks),64):
                encoded=tokenizer(chunks[start:start+64],max_length=512,padding=True,truncation=True,return_tensors='pt').to('cuda')
                with torch.inference_mode():
                    hidden=model(**encoded).last_hidden_state.float();mask=encoded['attention_mask'].unsqueeze(-1)
                    vectors=(hidden*mask).sum(1)/mask.sum(1);vectors=torch.nn.functional.normalize(vectors,p=2,dim=1).cpu().numpy()
                yield from vectors
    else:
        from fastembed import TextEmbedding
        from fastembed.common.model_description import ModelSource,PoolingType
        TextEmbedding.add_custom_model(model=MODEL,pooling=PoolingType.MEAN,normalization=True,sources=ModelSource(hf=MODEL),dim=384,model_file='onnx/model_qint8_avx512_vnni.onnx',license='mit')
        model=TextEmbedding(MODEL,cache_dir=str(CACHE),threads=2,local_files_only=True)
        def embed(chunks):return model.embed(chunks,batch_size=32,parallel=args.workers)
    for library in args.libraries:
        source=DATA/(library+'.sqlite');sha=hashlib.file_digest(source.open('rb'),'sha256').hexdigest()
        with sqlite3.connect(f'file:{source}?mode=ro',uri=True) as corpus:
            rows=list(corpus.execute('SELECT v.translation,v.book_id,v.chapter,v.verse,s.reference,v.text FROM verses v JOIN segments s USING(book_id,chapter,verse) ORDER BY v.translation,v.book_id,v.chapter,v.verse'))
        chunks=[];counts=[]
        for translation,book,chapter,verse,label,text in rows:
            parts=['passage: '+piece for piece in passage_chunks(module.normalize(text),chunk_tokenizer)];chunks.extend(parts);counts.append(len(parts))
        print(f'{library}: {len(rows):,} segments, {len(chunks):,} chunks, {'CUDA' if args.cuda else str(args.workers)+' CPU workers'}',flush=True)
        fd,path=tempfile.mkstemp(prefix=library+'-semantic-',suffix='.sqlite',dir=DATA);os.close(fd);started=time.monotonic()
        try:
            with sqlite3.connect(path) as db:
                db.executescript('CREATE TABLE passages(id INTEGER PRIMARY KEY,translation TEXT,book_id INTEGER,chapter INTEGER,first_verse INTEGER,last_verse INTEGER,label TEXT,text TEXT,vector BLOB);CREATE VIRTUAL TABLE passages_fts USING fts5(text,tokenize="unicode61 remove_diacritics 2");CREATE TABLE metadata(json TEXT);')
                embeddings=iter(embed(chunks))
                for id,(row,count) in enumerate(zip(rows,counts),1):
                    translation,book,chapter,verse,label,text=row
                    vector=np.mean([next(embeddings) for _ in range(count)],axis=0).astype(np.float32);norm=float(np.linalg.norm(vector));require(vector.shape == (384,) and np.isfinite(vector).all() and (norm > 1e-08))
                    db.execute('INSERT INTO passages VALUES(?,?,?,?,?,?,?,?,?)',(id,translation,book,chapter,verse,verse,label,text,(vector/norm).tobytes()));db.execute('INSERT INTO passages_fts(rowid,text) VALUES(?,?)',(id,module.normalize(text)))
                    if id%4096==0:print(f'{library}: {id:,}/{len(rows):,} segments · {time.monotonic()-started:.0f}s',flush=True)
                require(next(embeddings, None) is None)
                metadata={'format':1,'library':library,'model':MODEL,'license':'MIT','dimensions':384,'bible_sha256':sha,'passages':len(rows),'chunks':len(chunks),'chunk_tokens':384,'chunk_overlap_tokens':48,'pooling':'mean of normalized chunk embeddings, then L2 normalize','runtime':'PyTorch CUDA fp16' if args.cuda else 'FastEmbed ONNX int8','built_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}
                artifact_dir=DATA/'jewish-torch-model' if args.cuda else CACHE
                metadata['model_artifacts_sha256']={str(p.relative_to(artifact_dir)):hashlib.file_digest(p.open('rb'),'sha256').hexdigest() for p in artifact_dir.rglob('*') if p.is_file() and p.suffix in ['.onnx','.json','.txt','.safetensors'] and 'reranker' not in str(p)}
                db.execute('CREATE INDEX passage_lookup ON passages(translation,book_id,chapter,first_verse,last_verse)');db.execute('INSERT INTO metadata VALUES(?)',(json.dumps(metadata),))
            os.replace(path,DATA/(library+'-semantic.sqlite'));(DATA/(library+'-semantic-source.json')).write_text(json.dumps(metadata,indent=2)+'\n');print(f'{library}: READY in {time.monotonic()-started:.0f}s',flush=True)
        finally:Path(path).unlink(missing_ok=True)
if __name__=='__main__':main()
