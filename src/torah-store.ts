import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { literalFts } from './store';

export type TorahEdition = 'hebrew' | 'jps1917';
export type TorahBook = { id: number; work_id: string; name: string; hebrew_name: string; aliases: string; chapters: number };
export type TorahVerse = { id: number; edition: TorahEdition; book_id: number; chapter: number; verse: number; text: string };
export type TorahLocation = { book_id: number; chapter: number; verse: number };
export type TorahVersion = { id: TorahEdition; title: string; language: string; direction: string; license: string };
export function normalizeTorahSearch(value: string) {
  return value.normalize('NFD').replace(/\p{M}/gu, '').replace(/[\u05be\u05c0\u05c3\u05f3\u05f4]/gu, ' ');
}
export class TorahStore {
  readonly db: Database;
  readonly notes: Database;
  readonly books: TorahBook[];
  readonly editions: TorahVersion[];
  readonly metadata: { retrieved: string; versesPerEdition: number; entries: { book: string; language: string; versionTitle: string; url: string; sha256: string; license: string; versionSource: string }[] };
  constructor(notesPath = join(import.meta.dir, '../data/study.sqlite'), path = join(import.meta.dir, '../data/torah.sqlite')) {
    if (!existsSync(path)) throw new Error('The Torah library is not installed. Run bun run import:torah from the app directory.');
    this.db = new Database(path, { readonly: true });
    try {
      this.books = this.db.query<TorahBook, []>('SELECT * FROM books ORDER BY id').all();
      this.editions = this.db.query<TorahVersion, []>('SELECT * FROM editions ORDER BY id').all();
      this.metadata = JSON.parse(this.db.query<{ json: string }, []>('SELECT json FROM metadata').get()!.json);
      if (this.books.length !== 5 || this.editions.length !== 2) throw new Error('Incomplete Torah library. Re-run bun run import:torah.');
      this.notes = new Database(notesPath);
      this.notes.exec('CREATE TABLE IF NOT EXISTS torah_bookmarks(book_id INTEGER,chapter INTEGER,verse INTEGER,PRIMARY KEY(book_id,chapter,verse))');
    } catch (error) { this.db.close(); throw error; }
  }
  book(id: number) {
    const book = this.books.find(book => book.id === id);
    if (!book) throw new Error('Choose one of the five Torah books.');
    return book;
  }
  label(ref: TorahLocation) { return `${this.book(ref.book_id).name} ${ref.chapter}:${ref.verse}`; }
  chapter(book: number, chapter: number, edition: TorahEdition) {
    return this.db.query<TorahVerse, [number, number, string]>('SELECT id,edition,book_id,chapter,verse,text FROM verses WHERE book_id=? AND chapter=? AND edition=? ORDER BY verse').all(book, chapter, edition);
  }
  verse(ref: TorahLocation, edition: TorahEdition) {
    return this.db.query<TorahVerse, [number, number, number, string]>('SELECT id,edition,book_id,chapter,verse,text FROM verses WHERE book_id=? AND chapter=? AND verse=? AND edition=?').get(ref.book_id, ref.chapter, ref.verse, edition);
  }
  parseReference(value: string): TorahLocation | null {
    const match = value.trim().match(/^(.+?)\s+(\d+)(?:[:.](\d+))?$/u);
    if (!match) return null;
    const name = normalizeTorahSearch(match[1]).replace(/[.\s]/g, '').toLowerCase();
    const book = this.books.find(book => [book.name, book.hebrew_name, ...book.aliases.split('|')].some(alias => normalizeTorahSearch(alias).replace(/[.\s]/g, '').toLowerCase() === name));
    if (!book) throw new Error('That reference is outside this Torah library. Choose Genesis through Deuteronomy.');
    const ref = { book_id: book.id, chapter: Number(match[2]), verse: Number(match[3] ?? 1) };
    if (!this.verse(ref, 'hebrew')) throw new Error('That chapter or verse is not present in this Torah edition.');
    return ref;
  }
  search(query: string, limit = 100) {
    const edition: TorahEdition = /[\u0590-\u05ff]/u.test(query) ? 'hebrew' : 'jps1917';
    const fts = literalFts(normalizeTorahSearch(query));
    if (!fts) return { edition, verses: [] as TorahVerse[], total: 0 };
    const where = 'FROM verses_fts JOIN verses v ON v.id=verses_fts.rowid WHERE verses_fts MATCH ? AND v.edition=?';
    const total = this.db.query<{ n: number }, [string, string]>(`SELECT count(*) n ${where}`).get(fts, edition)!.n;
    const verses = this.db.query<TorahVerse, [string, string, number]>(`SELECT v.id,v.edition,v.book_id,v.chapter,v.verse,v.text ${where} ORDER BY bm25(verses_fts),v.book_id,v.chapter,v.verse LIMIT ?`).all(fts, edition, Math.max(1, Math.min(200, limit)));
    return { edition, verses, total };
  }
  adjacent(ref: TorahLocation, delta: number): TorahLocation | null {
    let id = ref.book_id, chapter = ref.chapter + delta;
    if (chapter < 1) { if (--id < 1) return null; chapter = this.book(id).chapters; }
    if (chapter > this.book(id).chapters) { if (++id > 5) return null; chapter = 1; }
    return { book_id: id, chapter, verse: 1 };
  }
  isSaved(ref: TorahLocation) { return !!this.notes.query('SELECT 1 FROM torah_bookmarks WHERE book_id=? AND chapter=? AND verse=?').get(ref.book_id, ref.chapter, ref.verse); }
  toggleSaved(ref: TorahLocation) {
    if (this.isSaved(ref)) this.notes.query('DELETE FROM torah_bookmarks WHERE book_id=? AND chapter=? AND verse=?').run(ref.book_id, ref.chapter, ref.verse);
    else this.notes.query('INSERT INTO torah_bookmarks VALUES(?,?,?)').run(ref.book_id, ref.chapter, ref.verse);
  }
  saved() { return this.notes.query<TorahLocation, []>('SELECT * FROM torah_bookmarks ORDER BY book_id,chapter,verse').all(); }
  close() { this.db.close(); this.notes.close(); }
}
