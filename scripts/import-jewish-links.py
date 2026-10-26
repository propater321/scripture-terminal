"""Validate Sefaria's bulk link snapshot against installed native references."""


def require(condition, message='Import validation failed'):
    if not condition:
        raise ValueError(message)

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import bisect,csv,hashlib,json,os,re,sqlite3,tempfile,time,urllib.request
ROOT=Path(__file__).resolve().parent.parent;DATA=ROOT/'data';CACHE=DATA/'sefaria-links';CACHE.mkdir(parents=True,exist_ok=True)
LIBS=['bavli','yerushalmi','mishnah','midrash','zohar','shulchan'];refs={};roots={};addresses={};entries=[];links={lib:set() for lib in LIBS}
for lib in LIBS:
 with sqlite3.connect(f'file:{DATA/(lib+".sqlite")}?mode=ro',uri=True) as db:
  for work,title in db.execute('SELECT work,ref_title FROM books'):roots[work]=lib;roots[title]=lib
  numbers=[]
  for b,c,v,ref in db.execute('SELECT book_id,chapter,verse,reference FROM segments ORDER BY book_id,chapter,verse'):
   key=b*1000000+c*1000+v;numbers.append(key);refs[ref]=(lib,key,key)
   prefix=ref
   while ':' in prefix.rsplit(' ',1)[-1]:
    prefix=prefix.rsplit(':',1)[0]
    old=refs.get(prefix);refs[prefix]=(lib,min(old[1],key),max(old[2],key)) if old else (lib,key,key)
  addresses[lib]=numbers
cache={}
def resolve(ref):
 if ref in cache:return cache[ref]
 if ref in refs:return refs[ref]
 parts=ref.replace('–','-').split('-');result=None
 if len(parts)==2:
  first=refs.get(parts[0]);last=refs.get(parts[1]);m=re.match(r'^(.* )([0-9][0-9ab:]*)$',parts[0]);tail=parts[1]
  if not last and m and re.fullmatch(r'[0-9][0-9ab:]*',tail):
   start=m[2].split(':');end=tail.split(':');last=refs.get(m[1]+':'.join(start[:len(start)-len(end)]+end))
  if first and last and first[0]==last[0] and first[1]<=last[2]:result=(first[0],first[1],last[2])
 cache[ref]=result;return result
manifest_path=ROOT/'sources/jewish-links-manifest.json';pinned={e['file']:e['sha256'] for e in json.loads(manifest_path.read_text())['entries']} if manifest_path.exists() else {}
def fetch(n):
 name=f'links{n}.csv';path=CACHE/name;url='https://storage.googleapis.com/sefaria-export/links/'+name
 if not path.exists():
  tmp=path.with_suffix('.tmp')
  for attempt in range(4):
   try:
    with urllib.request.urlopen(url,timeout=60) as response,tmp.open('wb') as out:
     while chunk:=response.read(1024*1024):out.write(chunk)
    os.replace(tmp,path);break
   except Exception:
    tmp.unlink(missing_ok=True)
    if attempt==3:raise
    time.sleep(1+attempt*2)
 sha=hashlib.file_digest(path.open('rb'),'sha256').hexdigest()
 if name in pinned:require(pinned[name] == sha, 'Connection snapshot changed: ' + name)
 return {'file':name,'url':url,'sha256':sha},path
excluded=0;matched=0
with ThreadPoolExecutor(max_workers=4) as pool:
 for entry,path in pool.map(fetch,range(17)):
  entries.append(entry)
  with path.open(newline='') as file:
   for row in csv.DictReader(file):
    lib=roots.get(row['Text 1'])
    if not lib or roots.get(row['Text 2'])!=lib:continue
    a,b=resolve(row['Citation 1']),resolve(row['Citation 2'])
    if not a or not b or a[0]!=b[0]:excluded+=1;continue
    matched+=1;values=addresses[lib]
    for source,target in [(a,b),(b,a)]:
     left=bisect.bisect_left(values,source[1]);right=bisect.bisect_right(values,source[2])
     if right-left>256:excluded+=1;continue
     links[lib].update((key,target[1],target[2],0) for key in values[left:right])
  print(path.name,{lib:len(items) for lib,items in links.items()},flush=True)
meta={'source':'Sefaria bulk connections','snapshot':time.strftime('%Y-%m-%d'),'url':'https://github.com/Sefaria/Sefaria-Export','entries':entries,'excluded_unavailable_or_broad':excluded,'matched_source_links':matched}
for lib,items in links.items():
 fd,path=tempfile.mkstemp(dir=DATA,suffix='.sqlite');os.close(fd)
 try:
  with sqlite3.connect(path) as db:
   db.executescript('CREATE TABLE links(source_key INTEGER,target_start INTEGER,target_end INTEGER,votes INTEGER,PRIMARY KEY(source_key,target_start,target_end));CREATE TABLE metadata(json TEXT);');db.executemany('INSERT INTO links VALUES(?,?,?,?)',sorted(items));db.execute('INSERT INTO metadata VALUES(?)',(json.dumps({**meta,'library':lib,'rows':len(items),'license':'Sefaria reference metadata; source texts retain their individual licenses'}),))
  os.replace(path,DATA/(lib+'-links.sqlite'))
 finally:Path(path).unlink(missing_ok=True)
manifest_path.write_text(json.dumps(meta,indent=2)+'\n');print('READY: validated within-library connections',flush=True)
