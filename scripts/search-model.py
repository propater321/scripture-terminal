"""Build and query Scripture's local passage embeddings; stdout is JSONL in worker mode."""
import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import time
import unicodedata
import re

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'data'
CACHE = DATA / 'models'
MODEL = 'BAAI/bge-small-en-v1.5'
RERANK_MODEL = 'Xenova/ms-marco-MiniLM-L-6-v2'
FORMAT = 1
LIBRARY = 'bible'
SOURCE_FILE = 'bible.sqlite'
INDEX_FILE = 'semantic.sqlite'
VERSION_COLUMN = 'translation'
# Keep a local query from consuming all cores on large workstations.
os.environ.setdefault('OMP_NUM_THREADS', '4')
os.environ.setdefault('OPENBLAS_NUM_THREADS', '1')
os.environ.setdefault('HF_HUB_DISABLE_TELEMETRY', '1')


def fingerprint():
    return hashlib.file_digest(open(DATA / SOURCE_FILE, 'rb'), 'sha256').hexdigest()


def load_model(offline=False):
    from fastembed import TextEmbedding
    if LIBRARY != 'bible':
        from fastembed.common.model_description import ModelSource, PoolingType
        TextEmbedding.add_custom_model(model=MODEL, pooling=PoolingType.MEAN, normalization=True, sources=ModelSource(hf=MODEL), dim=384, model_file='onnx/model_qint8_avx512_vnni.onnx', license='mit')
    if offline:
        os.environ['HF_HUB_OFFLINE'] = '1'
    return TextEmbedding(model_name=MODEL, cache_dir=str(CACHE), threads=4, local_files_only=offline)


def load_reranker(offline=False):
    from fastembed.rerank.cross_encoder import TextCrossEncoder
    model = TextCrossEncoder(RERANK_MODEL, cache_dir=str(CACHE / 'reranker'), threads=4, local_files_only=offline)
    if LIBRARY not in ['bible','torah']: model.model.tokenizer.enable_truncation(max_length=512)
    return model


def normalized(text):
    if LIBRARY == 'bible':
        return text
    return re.sub('[\u05be\u05c0\u05c3\u05f3\u05f4]', ' ', ''.join(c for c in unicodedata.normalize('NFD', text) if not unicodedata.combining(c)))

def documents(model, texts, batch_size=32):
    if LIBRARY != 'bible':
        return model.embed(['passage: ' + normalized(t) for t in texts], batch_size=batch_size)
    return model.passage_embed(texts, batch_size=batch_size)

def query_embedding(model, text):
    return model.embed(['query: ' + normalized(text)]) if LIBRARY != 'bible' else model.query_embed(text)

def prepare():
    load_model()
    load_reranker()
    artifacts = {str(file.relative_to(CACHE)): hashlib.file_digest(file.open('rb'), 'sha256').hexdigest() for file in sorted((CACHE / 'reranker').rglob('*')) if file.is_file() and file.suffix in ['.onnx', '.json', '.txt']}
    (DATA / ('torah-reranker-source.json' if LIBRARY != 'bible' else 'reranker-source.json')).write_text(json.dumps({'model': RERANK_MODEL, 'license': 'Apache-2.0', 'fastembed': importlib.metadata.version('fastembed'), 'artifacts_sha256': artifacts}, indent=2) + '\n')
    print('Embedding and reranking models cached for offline use.', flush=True)


def build():
    import numpy as np
    bible = sqlite3.connect(f'file:{DATA / SOURCE_FILE}?mode=ro', uri=True)
    books = dict(bible.execute('SELECT id,name FROM books'))
    passages = []
    for translation, book, chapter in bible.execute(f'SELECT DISTINCT {VERSION_COLUMN},book_id,chapter FROM verses ORDER BY {VERSION_COLUMN},book_id,chapter'):
        verses = list(bible.execute(f'SELECT verse,text FROM verses WHERE {VERSION_COLUMN}=? AND book_id=? AND chapter=? ORDER BY verse', (translation, book, chapter)))
        # Overlapping windows preserve nearby context and never cross a chapter boundary.
        for offset in range(0, len(verses), 3):
            window = verses[offset:offset + 5]
            if offset and len(window) < 2:
                continue
            first, last = window[0][0], window[-1][0]
            label = f'{books[book]} {chapter}:{first}' + (f'–{last}' if last != first else '')
            text = ' '.join(v[1] for v in window)
            passages.append((len(passages) + 1, translation, book, chapter, first, last, label, text))
    bible.close()
    print(f'Loading {MODEL}; indexing {len(passages):,} passage windows.', flush=True)
    model = load_model()
    metadata = {'format': FORMAT, 'library': LIBRARY, 'license': 'MIT' if LIBRARY != 'bible' else 'MIT', 'model': MODEL, 'dimensions': 384, 'fastembed': importlib.metadata.version('fastembed'), 'bible_sha256': fingerprint(), 'passages': len(passages), 'window_verses': 5, 'stride_verses': 3, 'built_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
    handle, path = tempfile.mkstemp(prefix='semantic-', suffix='.sqlite', dir=DATA)
    os.close(handle)
    started = time.monotonic()
    try:
        with sqlite3.connect(path) as db:
            db.execute('CREATE TABLE passages(id INTEGER PRIMARY KEY, translation TEXT, book_id INTEGER, chapter INTEGER, first_verse INTEGER, last_verse INTEGER, label TEXT, text TEXT, vector BLOB)')
            db.execute('CREATE VIRTUAL TABLE passages_fts USING fts5(text,tokenize="unicode61 remove_diacritics 2")')
            for batch_start in range(0, len(passages), 128):
                batch = passages[batch_start:batch_start + 128]
                embeddings = documents(model, [p[7] for p in batch])
                for row, vector in zip(batch, embeddings):
                    vector = np.asarray(vector, dtype=np.float32)
                    norm = float(np.linalg.norm(vector))
                    if vector.shape != (384,) or not np.isfinite(vector).all() or norm < 1e-8:
                        raise ValueError('Invalid embedding returned by the local model')
                    db.execute('INSERT INTO passages VALUES(?,?,?,?,?,?,?,?,?)', (*row, (vector / norm).tobytes()))
                if batch_start % 1024 == 0:
                    print(f'{min(batch_start + len(batch), len(passages)):,}/{len(passages):,} passages · {time.monotonic()-started:.0f}s', flush=True)
            db.executemany('INSERT INTO passages_fts(rowid,text) VALUES(?,?)', [(p[0], normalized(p[7])) for p in passages])
            db.execute('CREATE INDEX passage_lookup ON passages(translation,book_id,chapter)')
            artifacts = {}
            for file in sorted(CACHE.rglob('*')):
                if file.is_file() and file.suffix in ['.onnx', '.json', '.txt']:
                    artifacts[str(file.relative_to(CACHE))] = hashlib.file_digest(file.open('rb'), 'sha256').hexdigest()
            metadata['model_artifacts_sha256'] = artifacts
            db.execute('CREATE TABLE metadata(json TEXT NOT NULL)')
            db.execute('INSERT INTO metadata VALUES(?)', (json.dumps(metadata),))
        db.close()
        os.replace(path, DATA / INDEX_FILE)
        (DATA / INDEX_FILE.replace('.sqlite', '-source.json')).write_text(json.dumps(metadata, indent=2) + '\n')
        print(f'Ready: {len(passages):,} passages, {time.monotonic()-started:.0f}s. Search runs locally and offline.', flush=True)
    finally:
        Path(path).unlink(missing_ok=True)


def worker():
    import numpy as np
    db = sqlite3.connect(f'file:{DATA / INDEX_FILE}?mode=ro', uri=True)
    metadata = json.loads(db.execute('SELECT json FROM metadata').fetchone()[0])
    if metadata['format'] != FORMAT or metadata['model'] != MODEL or metadata['bible_sha256'] != fingerprint():
        raise ValueError('Semantic index is out of date. Run bun run index:semantic.')
    rows = list(db.execute('SELECT id,translation,book_id,vector,chapter,first_verse,last_verse FROM passages ORDER BY id'))
    db.close()
    ids = np.array([r[0] for r in rows])
    versions = np.array([r[1] for r in rows])
    books = np.array([r[2] for r in rows])
    vectors = np.stack([np.frombuffer(r[3], dtype=np.float32) for r in rows])
    addresses = [(r[2], r[4], r[5], r[6]) for r in rows]
    version_ids = {(r[1], *a): r[0] for r,a in zip(rows,addresses)}
    del rows
    model = load_model(offline=True)
    reranker = None
    if LIBRARY not in ['bible','torah']:
        from search_chunks import load_tokenizer,passage_chunks
        chunk_tokenizer=load_tokenizer(CACHE)
    print(json.dumps({'ready': True, 'model': MODEL, 'passages': len(ids)}), flush=True)
    for line in sys.stdin:
        request = {}
        try:
            request = json.loads(line)
            query = request['query']
            if not isinstance(query, str) or not 1 <= len(query.strip()) <= 4000:
                raise ValueError('Query must contain 1–4,000 characters')
            if request.get('method') == 'rerank':
                requested_ids = request.get('ids')
                if not isinstance(requested_ids, list) or not 1 <= len(requested_ids) <= 40 or not all(isinstance(i, int) for i in requested_ids):
                    raise ValueError('Reranking requires 1–40 passage IDs')
                if reranker is None:
                    reranker = load_reranker(offline=True)
                with sqlite3.connect(f'file:{DATA / INDEX_FILE}?mode=ro', uri=True) as db:
                    if LIBRARY != 'bible':
                        query_language = ('hebrew' if LIBRARY == 'torah' else 'original') if re.search('[\u0590-\u05ff]', query) else ('jps1917' if LIBRARY == 'torah' else 'english')
                        texts = [db.execute('SELECT coalesce(paired.text,p.text) FROM passages p LEFT JOIN passages paired ON paired.book_id=p.book_id AND paired.chapter=p.chapter AND paired.first_verse=p.first_verse AND paired.last_verse=p.last_verse AND paired.translation=? WHERE p.id=?', (query_language,i)).fetchone()[0] for i in requested_ids]
                    else:
                        texts = [db.execute('SELECT text FROM passages WHERE id=?', (i,)).fetchone()[0] for i in requested_ids]
                if LIBRARY not in ['bible','torah']:
                    # Long source segments can span thousands of tokens. Select their
                    # best semantic window before the bounded CPU cross-encoder pass.
                    query_vector=np.asarray(next(query_embedding(model,query)),dtype=np.float32)
                    query_vector/=max(float(np.linalg.norm(query_vector)),1e-8)
                    windows=[passage_chunks(normalized(t),chunk_tokenizer) for t in texts]
                    candidates=[piece for group in windows if len(group)>1 for piece in group]
                    embedded=iter(documents(model,candidates)) if candidates else iter([])
                    chosen=[]
                    for group in windows:
                        if len(group)==1:chosen.append(group[0]);continue
                        scores=[float(np.asarray(next(embedded))@query_vector) for _ in group]
                        chosen.append(group[int(np.argmax(scores))])
                    texts=chosen
                scores = list(reranker.rerank(normalized(query), [normalized(t) for t in texts], batch_size=4 if LIBRARY != 'bible' else 16))
                result = sorted([{'id': i, 'score': float(score)} for i, score in zip(requested_ids, scores)], key=lambda r: (-r['score'], r['id']))
                print(json.dumps({'id': request['id'], 'results': result}), flush=True)
                continue
            version = request.get('translation', 'WEB')
            if version not in (['KJV', 'WEB'] if LIBRARY == 'bible' else ['hebrew', 'jps1917'] if LIBRARY == 'torah' else ['original','english']):
                raise ValueError('Unknown translation')
            limit = max(1, min(200, int(request.get('limit', 80))))
            mask = np.ones(len(ids),dtype=bool) if LIBRARY != 'bible' else versions == version
            if request.get('book') is not None:
                mask &= books == int(request['book'])
            available = np.flatnonzero(mask)
            query_vector = np.asarray(next(query_embedding(model, query)), dtype=np.float32)
            query_vector /= max(float(np.linalg.norm(query_vector)), 1e-8)
            scores = vectors[available] @ query_vector
            chosen = np.argsort(-scores, kind='stable')
            result, seen = [], set()
            for i in chosen:
                offset = available[i]
                target = version_ids.get((version, *addresses[offset]), int(ids[offset])) if LIBRARY != 'bible' else int(ids[offset])
                if target in seen:
                    continue
                seen.add(target); result.append({'id':target,'score':float(scores[i])})
                if len(result) >= limit:
                    break
            print(json.dumps({'id': request['id'], 'results': result}), flush=True)
        except Exception as error:
            print(json.dumps({'id': request.get('id'), 'error': str(error)}), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['build', 'worker', 'prepare'])
    parser.add_argument('--library', choices=['bible', 'torah', 'bavli', 'yerushalmi', 'mishnah', 'midrash', 'zohar', 'shulchan'], default='bible')
    args = parser.parse_args()
    LIBRARY = args.library
    if LIBRARY != 'bible':
        SOURCE_FILE, INDEX_FILE, VERSION_COLUMN = LIBRARY+'.sqlite', LIBRARY+'-semantic.sqlite', 'edition' if LIBRARY == 'torah' else 'translation'
        MODEL, RERANK_MODEL = 'intfloat/multilingual-e5-small', 'BAAI/bge-reranker-v2-m3-int8'
        CACHE = DATA / 'torah-models'
    if args.command == 'build':
        if LIBRARY not in ['bible','torah']:parser.error('Use scripts/index-jewish.py '+LIBRARY+' to preserve native references.')
        build()
    elif args.command == 'prepare':
        prepare()
    else:
        try:
            worker()
        except Exception as error:
            print(json.dumps({'fatal': str(error)}), flush=True)
            sys.exit(1)
