"""Audit every imported segment, source checksum, and connection endpoint."""
import importlib.util,hashlib,json,sqlite3
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('importer',ROOT/'scripts/import-jewish.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def count_text(node):
 if isinstance(node,str):
  p=m.Text();p.feed(node);return int(bool(p.result()[0]))
 return sum(count_text(x) for x in (node.values() if isinstance(node,dict) else node))
reports=[]
for library in m.LIBRARIES:
 manifest=json.loads((ROOT/f'sources/{library}-manifest.json').read_text());db=sqlite3.connect(ROOT/f'data/{library}.sqlite')
 assert db.execute('pragma integrity_check').fetchone()[0]=='ok'
 for source in manifest['sources']+manifest['schemas']:
  raw=(ROOT/source['file']).read_bytes();assert hashlib.sha256(raw).hexdigest()==source['sha256']
  if 'edition' in source:assert count_text(json.loads(raw)['text'])==manifest['coverage'][source['work']][source['edition']],source
 assert db.execute('SELECT count(*) FROM verses WHERE text=""').fetchone()[0]==0
 assert db.execute('SELECT count(*) FROM verses v LEFT JOIN segments s USING(book_id,chapter,verse) WHERE s.reference IS NULL').fetchone()[0]==0
 valid={b*1000000+c*1000+v for b,c,v in db.execute('SELECT book_id,chapter,verse FROM segments')}
 with sqlite3.connect(ROOT/f'data/{library}-links.sqlite') as links:
  rows=links.execute('SELECT source_key,target_start,target_end FROM links').fetchall()
  assert all(a in valid and b in valid and c in valid and b<=c for a,b,c in rows)
 report={'library':library,'works':manifest['works'],'readingSections':manifest['books'],'coverage':{lang:sum(c[lang] for c in manifest['coverage'].values()) for lang in ['original','english','segments']},'connections':len(rows)};reports.append(report);print(json.dumps(report),flush=True)
 db.close()
for name in ['bible','torah']:
 source=ROOT/f'data/{name}.sqlite';index=ROOT/('data/semantic.sqlite' if name=='bible' else 'data/torah-semantic.sqlite')
 with sqlite3.connect(index) as db:meta=json.loads(db.execute('SELECT json FROM metadata').fetchone()[0])
 assert hashlib.file_digest(source.open('rb'),'sha256').hexdigest()==meta['bible_sha256'],name+' unchanged'
print('All source counts, checksums, native endpoints, and existing Bible/Torah indexes validated.')
(ROOT/'previews/jewish-data-audit.json').write_text(json.dumps(reports,indent=2)+'\n')
