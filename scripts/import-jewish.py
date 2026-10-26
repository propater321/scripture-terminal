"""Import named, licensed Sefaria editions into independent local libraries.
Canonical references, source HTML and edition provenance are retained; terminal text
is sanitized, and inline edition footnotes are kept separately from the main text.
"""


def require(condition, message='Import validation failed'):
    if not condition:
        raise ValueError(message)

import argparse,concurrent.futures,hashlib,json,os,re,sqlite3,tempfile,time,unicodedata,urllib.parse,urllib.request
from html.parser import HTMLParser
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent;DATA=ROOT/'data';CACHE=DATA/'jewish-source';CACHE.mkdir(parents=True,exist_ok=True)
ALLOWED={'Public Domain','CC0','CC-BY','CC-BY-SA','CC-BY-NC'}
MIDRASH=['Bereshit Rabbah','Shemot Rabbah','Vayikra Rabbah','Bamidbar Rabbah','Devarim Rabbah','Shir HaShirim Rabbah','Ruth Rabbah','Esther Rabbah','Kohelet Rabbah','Eikhah Rabbah','Midrash Tanchuma','Mekhilta DeRabbi Yishmael','Sifra','Sifrei Bamidbar','Sifrei Devarim']
LIBRARIES={'bavli':'Babylonian Talmud','yerushalmi':'Jerusalem Talmud','mishnah':'Mishnah','midrash':'Midrash','zohar':'Zohar','shulchan':'Shulchan Aruch'}
def digest(raw):return hashlib.sha256(raw).hexdigest()
def download(url,path):
    if path.exists():return path.read_bytes()
    for attempt in range(4):
        try:
            raw=urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Scripture-local-library/1.0'}),timeout=60).read();json.loads(raw);path.write_bytes(raw);return raw
        except Exception:
            if attempt==3:raise
            time.sleep(1+attempt*2)
def normalize(s):return re.sub('[\u05be\u05c0\u05c3\u05f3\u05f4]',' ',''.join(c for c in unicodedata.normalize('NFD',s) if not unicodedata.combining(c)))
class Text(HTMLParser):
    def __init__(self):super().__init__(convert_charrefs=True);self.main=[];self.notes=[];self.stack=[];self.note_depth=0;self.marker_depth=0;self.refs=[]
    def handle_starttag(self,tag,attrs):
        a=dict(attrs);classes=a.get('class','').split();note='footnote' in classes;marker='footnote-marker' in classes
        if a.get('data-ref'):self.refs.append(a['data-ref'])
        if tag in ['br','p','div']:self.handle_data('\n')
        if tag in ['br','hr','img','meta','input','wbr']:return
        self.stack.append((tag,note,marker));self.note_depth+=note;self.marker_depth+=marker
        if note:self.notes.append('\n')
    def handle_endtag(self,tag):
        for i in range(len(self.stack)-1,-1,-1):
            if self.stack[i][0]==tag:
                for _,n,m in self.stack[i:]:self.note_depth-=n;self.marker_depth-=m
                del self.stack[i:];break
    def handle_data(self,s):
        if self.note_depth:self.notes.append(s)
        elif not self.marker_depth:self.main.append(s)
    def result(self):
        def clean(parts):
            s=''.join(parts);s=''.join(c for c in s if ord(c)>=32 or c in '\n\t');s=re.sub('[\u007f-\u009f\u202a-\u202e\u2066-\u2069]','',s)
            return re.sub(r'\s+',' ',s).strip()
        return clean(self.main),clean(self.notes)
def title(node):return next((t['text'] for t in node.get('titles',[]) if t.get('lang')=='en' and t.get('primary')),node.get('key',''))
def leaves(node,path=()):
    if node.get('nodes'):
        for child in node['nodes']:
            yield from leaves(child,path+(() if child.get('default') else (title(child),)))
    else:yield path,node

def fetch_work(task):
    library,work=task;name=work['title'];slug=name.replace(' ','_');folder=CACHE/library;folder.mkdir(exist_ok=True)
    schema_url='https://storage.googleapis.com/sefaria-export/schemas/'+urllib.parse.quote(slug)+'.json'
    schema_raw=download(schema_url,folder/(slug+'-schema.json'));schema=json.loads(schema_raw)
    versions_url='https://www.sefaria.org/api/texts/versions/'+urllib.parse.quote(slug)
    versions=json.loads(download(versions_url,folder/(slug+'-versions.json')))
    selected={};sources=[]
    def preference(v):
        n=v['versionTitle'];priority=float(v.get('priority') or 0)
        if library=='shulchan' and n=='Sefaria Community Translation':return 1000
        if library=='bavli':return 1000 if n in ['William Davidson Edition - English','William Davidson Edition - Vocalized Aramaic'] else 900 if n=='William Davidson Edition - Aramaic' else priority
        if library=='yerushalmi':return 1000 if 'Guggenheimer' in n else priority
        favorites=['The Sefaria Midrash Rabbah, 2022','The Zohar; London, Soncino Press, 1933','Mishnah Yomit by Dr. Joshua Kulp','The Mishna with Obadiah Bartenura by Rabbi Shraga Silverstein','Midrash Tanhuma-Yelammedenu, trans. Samuel A. Berman','Mechilta, translated by Rabbi Shraga Silverstein','Sifra by Rabbi Shraga Silverstein']
        if n in favorites:return 1000
        if v['language']=='he':return 100+(20 if v['license']=='Public Domain' else 0)+priority
        if n=='Sefaria Community Translation':return 50+priority
        if 'Wikisource' in n or 'Wiki Translation'==n:return 60+priority
        return priority
    for lang,edition in [('he','original'),('en','english')]:
        candidates=[v for v in versions if v.get('actualLanguage',v['language'])==lang and v.get('license') in ALLOWED]
        if not candidates:continue
        version=max(candidates,key=preference);vt=version['versionTitle']
        # Export filenames omit colons, quotation marks and slashes.
        filename=vt.replace(':','').replace('"','').replace('/','')+'.json'
        object_name='/'.join(['json',*work['categories'],name,'Hebrew' if lang=='he' else 'English',filename])
        url='https://storage.googleapis.com/sefaria-export/'+urllib.parse.quote(object_name)
        path=folder/(slug+'-'+edition+'.json')
        try:raw=download(url,path)
        except Exception:
            listing='https://storage.googleapis.com/storage/v1/b/sefaria-export/o?'+urllib.parse.urlencode({'prefix':'/'.join(object_name.split('/')[:-1])+'/','fields':'items(name)','maxResults':1000})
            files=json.load(urllib.request.urlopen(listing))['items'];match=next((f['name'] for f in files if f['name'].split('/')[-1].replace('_',' ')==filename.replace('_',' ')),None)
            if not match:raise ValueError(f'Cannot locate reviewed edition {name}: {vt}')
            url='https://storage.googleapis.com/sefaria-export/'+urllib.parse.quote(match);raw=download(url,path)
        data=json.loads(raw)
        require(data['title'] == name and data['versionTitle'] == vt and (data['language'] == lang), (name, vt))
        require(data.get('license') in ALLOWED and data['license'] == version['license'], (name, 'license mismatch'))
        selected[edition]=data['text'];sources.append({'work':name,'edition':edition,'versionTitle':vt,'language':lang,'license':data['license'],'versionSource':data.get('versionSource',''),'url':url,'file':str(path.relative_to(ROOT)),'sha256':digest(raw)})
    if not selected:raise ValueError('No reviewed licensed editions for '+name)
    return library,work,schema,selected,sources,{'url':schema_url,'file':str((folder/(slug+'-schema.json')).relative_to(ROOT)),'sha256':digest(schema_raw)}

def flatten(data,depth,address_types,path=()):
    if depth==0:
        require(isinstance(data, str), (path, type(data)));yield path,data;return
    if not data:return
    require(isinstance(data, list), (path, type(data)))
    for i,value in enumerate(data,1):
        address=str((i+1)//2)+('a' if i%2 else 'b') if address_types[0]=='Talmud' else str(i)
        yield from flatten(value,depth-1,address_types[1:],path+(address,))

def build(library,works):
    entries=[x for x in works if x[0]==library];manifest_path=ROOT/'sources'/f'{library}-manifest.json'
    pinned=json.loads(manifest_path.read_text()) if manifest_path.exists() else None
    sources=[s for _,_,_,_,ss,_ in entries for s in ss];schemas=[e[-1] for e in entries]
    if pinned:
        expected={s['file']:s['sha256'] for s in pinned['sources']+pinned['schemas']}
        require(all((expected.get(s['file']) == s['sha256'] for s in sources + schemas)), 'Source snapshot changed; review the manifest before updating.')
    fd,temp=tempfile.mkstemp(prefix=library+'-',suffix='.sqlite',dir=DATA);os.close(fd);db=sqlite3.connect(temp)
    try:
        db.executescript('''CREATE TABLE books(id INTEGER PRIMARY KEY,name TEXT,osis TEXT,testament TEXT,chapters INTEGER,ref_title TEXT,aliases TEXT,summary TEXT,work TEXT);
        CREATE TABLE units(book_id INTEGER,chapter INTEGER,suffix TEXT,label TEXT,PRIMARY KEY(book_id,chapter),UNIQUE(book_id,suffix));
        CREATE TABLE segments(book_id INTEGER,chapter INTEGER,verse INTEGER,reference TEXT UNIQUE,PRIMARY KEY(book_id,chapter,verse));
        CREATE TABLE verses(id INTEGER PRIMARY KEY,translation TEXT,book_id INTEGER,chapter INTEGER,verse INTEGER,text TEXT,notes TEXT,raw_html TEXT,search_text TEXT,UNIQUE(translation,book_id,chapter,verse));
        CREATE INDEX verse_address ON verses(book_id,chapter,verse,translation);
        CREATE TABLE sources(work TEXT,edition TEXT,json TEXT,PRIMARY KEY(work,edition));CREATE TABLE metadata(json TEXT);
        CREATE VIRTUAL TABLE verses_fts USING fts5(search_text,content=verses,content_rowid=id,tokenize='unicode61 remove_diacritics 2');''')
        book_id=0;coverage={};all_refs=[]
        for _,work,schema,texts,ss,_ in entries:
            name=work['title'];coverage[name]={'original':0,'english':0,'segments':0}
            for source in ss:db.execute('INSERT INTO sources VALUES(?,?,?)',(name,source['edition'],json.dumps(source,ensure_ascii=False)))
            for node_path,node in leaves(schema['schema']):
                edition_rows={}
                for edition,data in texts.items():
                    payload=data
                    for key in node_path:
                        if isinstance(payload,dict):payload=payload.get(key,[])
                        else:payload=[];break
                    # Default nodes are exported under the default key.
                    if isinstance(payload,dict) and node.get('default'):payload=payload.get('',payload.get('default',[]))
                    rows={}
                    for address,html in flatten(payload,node['depth'],node['addressTypes']):
                        if not html.strip():continue
                        parser=Text();parser.feed(html);main,notes=parser.result()
                        if main:rows[address]=(main,notes,html,parser.refs)
                    edition_rows[edition]=rows
                addresses=set(a for rows in edition_rows.values() for a in rows)
                if not addresses:continue
                def sort_address(a):return tuple(int(x[:-1])*2+(x[-1]=='b') if re.fullmatch(r'\d+[ab]',x) else int(x) for x in a)
                addresses=sorted(addresses,key=sort_address);units=list(dict.fromkeys(a[:-1] for a in addresses))
                require(len(units) < 1000 and all((int(a[-1]) < 1000 for a in addresses)), ('Address capacity', name, node_path))
                book_id+=1;ref_title=name+(', '+', '.join(node_path) if node_path else '')
                display=ref_title.replace('Jerusalem Talmud ','').replace('Mishnah ','').replace('Shulchan Arukh, ','').replace('Zohar, ','')
                aliases=[t['text'] for t in schema['schema'].get('titles',[]) if t.get('lang') in ['en','he']] if not node_path else [ref_title]
                aliases+=[ref_title,display]
                group=work['categories'][-1] if library in ['bavli','yerushalmi','mishnah'] else name if library=='midrash' else LIBRARIES[library]
                summary=work.get('enShortDesc') or work.get('enDesc') or f'{ref_title}. Read the source text and its available edition alongside the original.'
                parser=Text();parser.feed(summary);summary=parser.result()[0]
                db.execute('INSERT INTO books VALUES(?,?,?,?,?,?,?,?,?)',(book_id,display,display[:8],group,len(units),ref_title,json.dumps(list(dict.fromkeys(aliases)),ensure_ascii=False),summary,name))
                unit_ids={unit:i for i,unit in enumerate(units,1)}
                for unit,i in unit_ids.items():
                    suffix=':'.join(unit);label=suffix or 'Text';db.execute('INSERT INTO units VALUES(?,?,?,?)',(book_id,i,suffix,label))
                for address in addresses:
                    chapter=unit_ids[address[:-1]];verse=int(address[-1]);ref=ref_title+' '+':'.join(address);coverage[name]['segments']+=1
                    db.execute('INSERT INTO segments VALUES(?,?,?,?)',(book_id,chapter,verse,ref))
                    for edition,rows in edition_rows.items():
                        row=rows.get(address)
                        if not row:continue
                        text,notes,html,refs=row;coverage[name][edition]+=1
                        db.execute('INSERT INTO verses(translation,book_id,chapter,verse,text,notes,raw_html,search_text) VALUES(?,?,?,?,?,?,?,?)',(edition,book_id,chapter,verse,text,notes,html,normalize(text)))
                        all_refs.extend((ref,r) for r in refs)
        def source_count(data):
            if isinstance(data,str):
                parser=Text();parser.feed(data);return int(bool(parser.result()[0]))
            return sum(source_count(x) for x in (data.values() if isinstance(data,dict) else data))
        for _,work,_,texts,_,_ in entries:
            for edition,data in texts.items():
                expected=source_count(data);actual=coverage[work['title']][edition]
                require(expected == actual, (work['title'], edition, 'unmapped source segments', expected, actual))
        require(all((c['segments'] for c in coverage.values())), 'A selected work has no imported text')
        db.execute("INSERT INTO verses_fts(verses_fts) VALUES('rebuild')")
        manifest={'library':library,'name':LIBRARIES[library],'retrieved':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'sources':sources,'schemas':schemas,'coverage':coverage,'works':len(entries),'books':book_id,'transformations':['HTML formatting flattened for terminal display; source HTML retained.','Inline edition footnotes separated from main text; original edition text is never machine-translated.','Native references retained; missing translations are represented as gaps.']}
        db.execute('INSERT INTO metadata VALUES(?)',(json.dumps(manifest,ensure_ascii=False),));db.commit();require(db.execute('pragma integrity_check').fetchone()[0] == 'ok');db.close();os.replace(temp,DATA/(library+'.sqlite'))
        manifest_path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n');(DATA/(library+'-inline-links.json')).write_text(json.dumps(all_refs,ensure_ascii=False));print(f'{library}: {len(entries)} works, {book_id} reading sections, '+str({e:sum(c[e] for c in coverage.values()) for e in ['original','english','segments']}),flush=True)
    finally:db.close();Path(temp).unlink(missing_ok=True)

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--library',choices=[*LIBRARIES,'all'],default='all');args=parser.parse_args()
    toc=json.loads(download('https://storage.googleapis.com/sefaria-export/table_of_contents.json',CACHE/'toc.json'))
    def flat(nodes):
        for x in nodes:
            if 'title' in x:yield x
            else:yield from flat(x.get('contents',[]))
    catalog=list(flat(toc));tasks=[]
    for library in LIBRARIES:
        if args.library not in ['all',library]:continue
        if library in ['bavli','yerushalmi']:works=[x for x in catalog if x.get('categories',[])[:2]==['Talmud','Bavli' if library=='bavli' else 'Yerushalmi'] and len(x['categories'])==3 and x['categories'][2].startswith('Seder ') and not x.get('dependence')]
        elif library=='mishnah':works=[x for x in catalog if x.get('categories',[])[:1]==['Mishnah'] and len(x['categories'])==2 and x['categories'][1].startswith('Seder ') and not x.get('dependence')]
        elif library=='midrash':works=[next(x for x in catalog if x['title']==name) for name in MIDRASH]
        elif library=='zohar':works=[next(x for x in catalog if x['title']=='Zohar')]
        else:works=[next(x for x in catalog if x['title']=='Shulchan Arukh, '+part) for part in ['Orach Chayim',"Yoreh De'ah",'Even HaEzer','Choshen Mishpat']]
        tasks.extend((library,w) for w in works)
    results=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        for i,result in enumerate(pool.map(fetch_work,tasks),1):
            results.append(result)
            if i%10==0:print(f'Downloaded {i}/{len(tasks)} works',flush=True)
    for library in LIBRARIES:
        if any(r[0]==library for r in results):build(library,results)
if __name__=='__main__':main()
