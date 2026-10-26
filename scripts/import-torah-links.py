"""Cache Sefaria's Torah-to-Torah links in native Sefaria numbering."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import hashlib,json,sqlite3,urllib.request,urllib.parse,time,re,os,tempfile
ROOT=Path(__file__).resolve().parent.parent
DATA=ROOT/'data'; CACHE=DATA/'torah-links-source'; CACHE.mkdir(parents=True,exist_ok=True)
with sqlite3.connect(f'file:{DATA / "torah.sqlite"}?mode=ro',uri=True) as db:
    books=list(db.execute('SELECT id,name,chapters FROM books ORDER BY id'))
    verses={(b,c,v) for b,c,v in db.execute("SELECT book_id,chapter,verse FROM verses WHERE edition='hebrew'")}
    ends={(b,c):max(v for bb,cc,v in verses if (bb,cc)==(b,c)) for b,_,n in books for c in range(1,n+1)}
manifest=ROOT/'sources/torah-links-manifest.json'
pinned={e['file']:e['sha256'] for e in json.loads(manifest.read_text())['entries']} if manifest.exists() else {}
names={name:b for b,name,n in books}
def parse(ref):
    m=re.fullmatch(r'(Genesis|Exodus|Leviticus|Numbers|Deuteronomy) (\d+)(?::(\d+))?(?:-(?:(\d+):)?(\d+))?',ref)
    if not m:return None
    name,c,v,ec,ev=m.groups();b=names[name];c=int(c);start=(b,c,int(v or 1))
    if ev: end=(b,int(ec or c) if v else int(ev),int(ev) if v else ends.get((b,int(ev)),0))
    else:end=(b,c,int(v) if v else ends.get((b,c),0))
    if start not in verses or end not in verses or end<start:
        unparsed.append(ref);return None
    return start,end
jobs=[(name,c) for _,name,n in books for c in range(1,n+1)]
def fetch(job):
    name,ch=job;path=CACHE/f'{name}-{ch}.json';url=f'https://www.sefaria.org/api/links/{name}.{ch}?with_text=0&category=Tanakh'
    for attempt in range(4):
      try:
        raw=path.read_bytes() if path.exists() else urllib.request.urlopen(url,timeout=45).read()
        if path.name in pinned and hashlib.sha256(raw).hexdigest()!=pinned[path.name]:raise ValueError('Connection snapshot checksum changed: '+path.name)
        data=json.loads(raw)
        if not isinstance(data,list):raise ValueError(str(data)[:100])
        path.write_bytes(raw)
        return {'file':path.name,'url':url,'sha256':hashlib.sha256(raw).hexdigest()},data
      except Exception:
        if attempt==3:raise
        time.sleep(1+attempt*2)
links=set();entries=[];unparsed=[]
with ThreadPoolExecutor(max_workers=4) as pool:
  for i,(entry,rows) in enumerate(pool.map(fetch,jobs)):
    entries.append(entry)
    for row in rows:
      a,b=parse(row.get('anchorRef','')),parse(row.get('ref',''))
      if not a or not b:continue
      # Link both ways; source verses retain exact addresses, targets retain ranges.
      for source,target in [(a,b),(b,a)]:
        for address in verses:
          if source[0]<=address<=source[1]:links.add((address[0]*1000000+address[1]*1000+address[2],target[0][0]*1000000+target[0][1]*1000+target[0][2],target[1][0]*1000000+target[1][1]*1000+target[1][2],0))
    if i%20==0:print(f'{i+1}/{len(jobs)} chapters; {len(links)} links',flush=True)
if not links:raise ValueError('No Torah connections imported')
meta={'source':'Sefaria','url':'https://developers.sefaria.org/reference/get-links','snapshot':time.strftime('%Y-%m-%d'),'rows':len(links),'license':'Sefaria link metadata; see https://github.com/Sefaria/Sefaria-Export/blob/master/LICENSE.md','scope':'Torah-to-Torah only; Sefaria numbering','entries':entries,'excluded_invalid_references':sorted(set(unparsed))}
fd,path=tempfile.mkstemp(dir=DATA,suffix='.sqlite');os.close(fd)
try:
  with sqlite3.connect(path) as db:
    db.execute('CREATE TABLE links(source_key INTEGER,target_start INTEGER,target_end INTEGER,votes INTEGER,PRIMARY KEY(source_key,target_start,target_end))')
    db.executemany('INSERT INTO links VALUES(?,?,?,?)',sorted(links));db.execute('CREATE TABLE metadata(json TEXT)');db.execute('INSERT INTO metadata VALUES(?)',(json.dumps(meta),))
  os.replace(path,DATA/'torah-links.sqlite');(DATA/'torah-links-source.json').write_text(json.dumps(meta,indent=2)+'\n')
finally:Path(path).unlink(missing_ok=True)
print(f'Ready: {len(links)} Torah connections',flush=True)
