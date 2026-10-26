import { Database } from 'bun:sqlite';
import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import manifest from '../sources/bible-manifest.json';
import { verifiedCorpus } from './import-bible-validation';
const directory = join(import.meta.dir, '../data');
await mkdir(directory, { recursive: true });
const sources = await Promise.all(manifest.sources.map(async source => {
  const cached = Bun.file(join(directory, `${source.translation.toLowerCase()}.json`));
  const exists = await cached.exists();
  let raw: string;
  if (exists) raw = await cached.text();
  else {
    const response = await fetch(source.url, {signal: AbortSignal.timeout(60_000)});
    if (!response.ok) throw new Error(`Download failed: ${response.status} ${source.url}`);
    raw = await response.text();
  }
  const corpus = verifiedCorpus(raw, source);
  if (!exists) await Bun.write(cached, raw);
  return {...source, corpus};
}));
const temporary = await mkdtemp(join(directory, 'bible-import-'));
let db: Database | undefined;
try {
  db = new Database(join(temporary, 'bible.sqlite'));
  db.exec(`CREATE TABLE books (id INTEGER PRIMARY KEY, osis TEXT UNIQUE, name TEXT, testament TEXT, chapters INTEGER);
    CREATE TABLE verses (id INTEGER PRIMARY KEY, translation TEXT NOT NULL, book_id INTEGER NOT NULL, chapter INTEGER NOT NULL, verse INTEGER NOT NULL, text TEXT NOT NULL, UNIQUE(translation,book_id,chapter,verse));
    CREATE INDEX verse_reference ON verses(translation,book_id,chapter,verse);
    CREATE VIRTUAL TABLE verses_fts USING fts5(text,content='verses',content_rowid='id',tokenize='unicode61',prefix='2 3 4');`);
  const putBook = db.prepare('INSERT OR IGNORE INTO books VALUES (?,?,?,?,?)');
  const putVerse = db.prepare('INSERT INTO verses(translation,book_id,chapter,verse,text) VALUES (?,?,?,?,?)');
  db.transaction(() => {
    for (const {translation,corpus,verses} of sources) {
      for (const book of corpus.books) {
        putBook.run(book.bookId,book.book,book.englishName,book.testament,book.chapters.length);
        for (const chapter of book.chapters) for (const verse of chapter.verses) putVerse.run(translation,book.bookId,chapter.chapter,verse.number,verse.text);
      }
      console.log(`${translation}: ${verses.toLocaleString()} verses imported`);
    }
    db!.exec("INSERT INTO verses_fts(verses_fts) VALUES ('rebuild')");
  })();
  if (db.query<{integrity_check:string},[]>('PRAGMA integrity_check').get()?.integrity_check !== 'ok') throw new Error('Imported database failed integrity validation.');
  db.close(); db = undefined;
  await rename(join(temporary,'bible.sqlite'),join(directory,'bible.sqlite'));
  await Bun.write(join(directory,'sources.json'),JSON.stringify(manifest,null,2)+'\n');
  console.log('Offline corpus ready. Run bun start.');
} finally {db?.close();await rm(temporary,{recursive:true,force:true});}
