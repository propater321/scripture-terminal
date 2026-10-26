"""Import pinned, edition-specific Sefaria Torah exports into a separate SQLite DB."""


def require(condition, message='Import validation failed'):
    if not condition:
        raise ValueError(message)

from pathlib import Path
import hashlib, json, os, re, sqlite3, unicodedata, urllib.request

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / 'sources/torah-manifest.json'
BOOKS = [('Genesis', 50, 1533, 'Bereshit|Bereishit'), ('Exodus', 40, 1210, 'Shemot'), ('Leviticus', 27, 859, 'Vayikra|Vayiqra'), ('Numbers', 36, 1288, 'Bamidbar|Bemidbar'), ('Deuteronomy', 34, 956, 'Devarim|Debarim')]

def searchable(text):
    return re.sub(r'[\u05be\u05c0\u05c3\u05f3\u05f4]', ' ', ''.join(c for c in unicodedata.normalize('NFD', text) if not unicodedata.combining(c)))

def main():
    manifest = json.loads(MANIFEST.read_text())
    cache = ROOT / 'data/torah-source'; cache.mkdir(parents=True, exist_ok=True)
    datasets = {}
    for entry in manifest['entries']:
        require(entry['license'] == 'Public Domain')
        file = cache / entry['filename']
        if not file.exists():
            with urllib.request.urlopen(entry['url'], timeout=60) as response: raw = response.read()
            require(hashlib.sha256(raw).hexdigest() == entry['sha256'], f"Changed source: {entry['filename']}")
            file.write_bytes(raw)
        raw = file.read_bytes()
        require(hashlib.sha256(raw).hexdigest() == entry['sha256'], f'Source checksum mismatch: {file}')
        data = json.loads(raw)
        require(data['versionTitle'] == entry['versionTitle'] and data['license'] == entry['license'])
        require(data['title'] == entry['book'] and data['language'] == entry['language'])
        datasets[(entry['book'], entry['language'])] = (entry, data)
    require(len(datasets) == 10)
    target = ROOT / 'data/torah.sqlite'
    temp = target.with_name(f'torah.sqlite.{os.getpid()}.tmp')
    db = sqlite3.connect(temp)
    try:
        db.executescript('''
          PRAGMA foreign_keys=ON;
          CREATE TABLE editions(id TEXT PRIMARY KEY, title TEXT NOT NULL, language TEXT NOT NULL, direction TEXT NOT NULL, license TEXT NOT NULL);
          CREATE TABLE books(id INTEGER PRIMARY KEY, work_id TEXT UNIQUE NOT NULL, name TEXT NOT NULL, hebrew_name TEXT NOT NULL, aliases TEXT NOT NULL, chapters INTEGER NOT NULL);
          CREATE TABLE verses(id INTEGER PRIMARY KEY, edition TEXT REFERENCES editions(id), book_id INTEGER REFERENCES books(id), chapter INTEGER NOT NULL, verse INTEGER NOT NULL, text TEXT NOT NULL, search_text TEXT NOT NULL, UNIQUE(edition,book_id,chapter,verse));
          CREATE TABLE sources(book_id INTEGER REFERENCES books(id), edition TEXT REFERENCES editions(id), json TEXT NOT NULL, PRIMARY KEY(book_id,edition));
          CREATE TABLE metadata(json TEXT NOT NULL);
          CREATE VIRTUAL TABLE verses_fts USING fts5(search_text, content=verses, content_rowid=id, tokenize='unicode61 remove_diacritics 2');
        ''')
        for language, edition in [('he','hebrew'),('en','jps1917')]:
            entry, data = datasets[('Genesis',language)]
            db.execute('INSERT INTO editions VALUES(?,?,?,?,?)', (edition, entry['versionTitle'], language, 'rtl' if language == 'he' else 'ltr', entry['license']))
        totals = {}
        for id, (name, chapters, count, aliases) in enumerate(BOOKS, 1):
            hebrew = datasets[(name,'he')][1]
            db.execute('INSERT INTO books VALUES(?,?,?,?,?,?)', (id, 'torah:'+name.lower(), name, hebrew['heTitle'], aliases, chapters))
            shapes=[]
            for language, edition in [('he','hebrew'),('en','jps1917')]:
                entry, data = datasets[(name,language)]
                require(len(data['text']) == chapters and sum(map(len, data['text'])) == count, name)
                shapes.append([len(chapter) for chapter in data['text']])
                for chapter, verses in enumerate(data['text'],1):
                    for verse,text in enumerate(verses,1):
                        require(isinstance(text, str) and text.strip() and (not re.search('<[^>]+>', text)), (name, chapter, verse))
                        require(not any((ord(c) < 32 and c not in '\n\r\t' for c in text)), 'Unexpected terminal control')
                        db.execute('INSERT INTO verses(edition,book_id,chapter,verse,text,search_text) VALUES(?,?,?,?,?,?)',(edition,id,chapter,verse,text,searchable(text)))
                db.execute('INSERT INTO sources VALUES(?,?,?)',(id,edition,json.dumps(entry,ensure_ascii=False)))
            require(shapes[0] == shapes[1], f'Parallel edition alignment differs: {name}')
            totals[name]=count
        db.execute("INSERT INTO verses_fts(verses_fts) VALUES('rebuild')")
        provenance={**manifest,'versesPerEdition':sum(totals.values()),'bookCounts':totals,'transformations':['Original verse strings preserved; search_text strips combining marks and normalizes Hebrew punctuation for indexing.','Sefaria edition numbering retained; not remapped to KJV/WEB.']}
        db.execute('INSERT INTO metadata VALUES(?)',(json.dumps(provenance,ensure_ascii=False),))
        db.commit()
        require(db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok')
        db.close(); os.replace(temp,target)
        (ROOT/'data/torah-source.json').write_text(json.dumps(provenance,ensure_ascii=False,indent=2)+'\n')
        print(f'Imported {sum(totals.values()):,} verses per edition, {2*sum(totals.values()):,} total into {target}')
    finally:
        db.close()
        temp.unlink(missing_ok=True)

if __name__=='__main__': main()
