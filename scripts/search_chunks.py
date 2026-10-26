"""Token-bounded overlapping windows; retain the complete source separately."""
from pathlib import Path
from tokenizers import Tokenizer

def load_tokenizer(cache):
    path=next((Path(cache)/'models--intfloat--multilingual-e5-small'/'snapshots').glob('*/tokenizer.json'))
    tokenizer=Tokenizer.from_file(str(path));tokenizer.no_truncation();tokenizer.no_padding()
    return tokenizer

def passage_chunks(text,tokenizer,size=384,overlap=48):
    offsets=tokenizer.encode(text,add_special_tokens=False).offsets
    chunks=[]
    for start in range(0,len(offsets),size-overlap):
        end=min(start+size,len(offsets));piece=text[offsets[start][0]:offsets[end-1][1]].strip()
        if piece:chunks.append(piece)
        if end==len(offsets):break
    return chunks or [text]
