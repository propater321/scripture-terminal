"""Local reranking evaluation over the same candidate pool; no Codex requests."""
import json
import time
from pathlib import Path
from fastembed.rerank.cross_encoder import TextCrossEncoder
ROOT=Path(__file__).resolve().parent.parent
model_name='Xenova/ms-marco-MiniLM-L-6-v2'
model=TextCrossEncoder(model_name, cache_dir=str(ROOT/'data/models/reranker'), threads=4)
data=json.loads((ROOT/'previews/rerank-candidates.json').read_text())
rows=[]
for case in data:
    started=time.monotonic()
    scores=list(model.rerank(case['query'],[hit['text'] for hit in case['hits']],batch_size=16))
    ordered=sorted(zip(case['hits'],scores),key=lambda pair:-pair[1])
    rank=next((i+1 for i,(hit,score) in enumerate(ordered) if hit['relevant']),None)
    rows.append({'query':case['query'],'rank':rank,'ms':round((time.monotonic()-started)*1000),'references':[h['label'] for h,s in ordered[:10]]})
    print(json.dumps(rows[-1]),flush=True)
report={'model':model_name,'hitAt5':sum(r['rank'] is not None and r['rank']<=5 for r in rows),'hitAt10':sum(r['rank'] is not None and r['rank']<=10 for r in rows),'questions':len(rows),'results':rows}
(ROOT/'previews/rerank-evaluation.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if k!='results'}),flush=True)
