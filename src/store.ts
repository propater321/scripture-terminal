import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { addressKey, decodeAddress, type PassageRange } from './references';

export type Translation = 'KJV' | 'WEB' | 'hebrew' | 'jps1917' | 'original' | 'english';
export type Book = { id: number; osis: string; name: string; testament: string; chapters: number };
export type Verse = { id: number; translation: Translation; book_id: number; chapter: number; verse: number; text: string; notes?: string; missing?: boolean };
export type Reference = { book: Book; chapter: number; verse: number; end?: number };
export type SearchResult = { verses: Verse[]; total: number; counts: Map<number, number> };
export type CrossReference = { range: PassageRange; votes: number };
export type Passage = { range: PassageRange; label: string; verses: Verse[]; total: number; omitted: boolean };
const extraAliases: Record<string, string> = { gn: 'Gen', ex: 'Exod', psalm: 'Ps', psalms: 'Ps', pss: 'Ps', pr: 'Prov', eccl: 'Eccl', ecclesiastes: 'Eccl', song: 'Song', 'song of solomon': 'Song', 'song of songs': 'Song', mt: 'Matt', mk: 'Mark', lk: 'Luke', jn: 'John', joh: 'John', ro: 'Rom', revelation: 'Rev', revelations: 'Rev', '1jn': '1John', '2jn': '2John', '3jn': '3John' };

export function literalFts(query: string): string {
  const parts = query.match(/"[^"]*"|[\p{L}\p{N}]+/gu) ?? [];
  return parts.map(part => {
    const phrase = part.startsWith('"');
    const words = part.match(/[\p{L}\p{N}]+/gu) ?? [];
    return words.length ? `"${words.join(' ')}"${phrase ? '' : '*'}` : '';
  }).filter(Boolean).join(' AND ');
}

export type LibraryId = 'bible' | 'torah' | 'bavli' | 'yerushalmi' | 'mishnah' | 'midrash' | 'zohar' | 'shulchan';
export type LibraryProfile = { id: LibraryId; shortName?: string; bookTerm?: string; unitTerm?: string; segmentTerm?: string; name: string; editions: Translation[]; defaultEdition: Translation; sourceFile: string; indexFile: string; versionColumn: 'translation' | 'edition'; linksSource: string; linksCredit: string };
export type ScriptureStore = Pick<BibleStore, 'profile' | 'db' | 'books' | 'links' | 'linksError' | 'linksMetadata' | 'book' | 'label' | 'parseReference' | 'chapter' | 'verse' | 'rangeLabel' | 'passage' | 'crossReferences' | 'search' | 'saved' | 'isSaved' | 'toggleSaved'> & { unitLabel?(book: number, chapter: number): string; resolveReference?(query: string, translation: Translation): PassageRange; bookGuide?(id: number): {summary: string; themes: string[]; highlights: {label: string; chapter: number}[]}; sourcesFor?(id: number): {versionTitle: string; edition: string; license: string; url: string; versionSource: string}[]; coverageFor?(id: number): {original: number; english: number; segments: number}; };
export const editionName = (edition: Translation) => ({ KJV: 'KJV', WEB: 'WEB', hebrew: 'Hebrew', jps1917: 'JPS 1917', original: 'Original', english: 'English' })[edition];
export const unitName = (store: ScriptureStore, book: number, chapter: number) => store.unitLabel?.(book, chapter) ?? String(chapter);
export const isJewishLibrary = (store: ScriptureStore) => store.profile.id !== 'bible';
export const isRabbinicLibrary = (store: ScriptureStore) => !['bible','torah'].includes(store.profile.id);
export const parallelEdition = (store: ScriptureStore, edition: Translation) => store.profile.editions.find(v => v !== edition)!;

export class BibleStore {
  readonly profile: LibraryProfile = { id: 'bible', name: 'Bible', editions: ['WEB', 'KJV'], defaultEdition: 'WEB', sourceFile: 'bible.sqlite', indexFile: 'semantic.sqlite', versionColumn: 'translation', linksSource: 'OpenBible.info', linksCredit: 'OpenBible.info / CC BY 4.0' };
  db: Database;
  notes: Database;
  books: Book[];
  links?: Database;
  linksError?: string;
  linksMetadata?: { source: string; snapshot: string; rows: number; license: string };
  constructor(notesPath = join(import.meta.dir, '../data/study.sqlite'), linksPath = join(import.meta.dir, '../data/crossrefs.sqlite')) {
    this.db = new Database(join(import.meta.dir, '../data/bible.sqlite'), { readonly: true });
    this.notes = new Database(notesPath);
    this.notes.exec('CREATE TABLE IF NOT EXISTS bookmarks(book_id INTEGER,chapter INTEGER,verse INTEGER,PRIMARY KEY(book_id,chapter,verse))');
    this.books = this.db.query<Book, []>('SELECT * FROM books ORDER BY id').all();
    if (existsSync(linksPath)) {
      try {
        this.links = new Database(linksPath, { readonly: true });
        this.linksMetadata = JSON.parse(this.links.query<{ json: string }, []>('SELECT json FROM metadata').get()!.json);
        this.links.query('SELECT source_key FROM links LIMIT 1').get();
      } catch {
        this.links?.close(); this.links = undefined;
        this.linksError = 'Cross-reference data could not be opened. Run bun run import:links.';
      }
    }
  }
  book(id: number) { return this.books.find(b => b.id === id)!; }
  label(verse: Pick<Verse, 'book_id' | 'chapter' | 'verse'>) { return `${this.book(verse.book_id).name} ${verse.chapter}:${verse.verse}`; }
  parseReference(query: string): Reference | null {
    const match = query.trim().match(/^(.+?)\s*\.?\s*(\d+)(?:[:.](\d+)(?:-(\d+))?)?$/u);
    if (!match) return null;
    const name = match[1].replace(/[.\s]/g, '').toLowerCase();
    const alias = extraAliases[match[1].trim().toLowerCase()] ?? extraAliases[name];
    const book = this.books.find(b => [b.osis, b.name, alias === b.osis ? name : ''].some(s => s.replace(/\s/g, '').toLowerCase() === name));
    if (!book) return null;
    const chapter = Number(match[2]), verse = Number(match[3] ?? 1), end = match[4] ? Number(match[4]) : undefined;
    if (chapter < 1 || chapter > book.chapters || verse < 1 || (end && end < verse)) throw new Error('That passage is outside this book.');
    return { book, chapter, verse, end };
  }
  chapter(book: number, chapter: number, translation: Translation) {
    return this.db.query<Verse, [number, number, string]>('SELECT * FROM verses WHERE book_id=? AND chapter=? AND translation=? ORDER BY verse').all(book, chapter, translation);
  }
  verse(book: number, chapter: number, verse: number, translation: Translation) {
    return this.db.query<Verse, [number, number, number, string]>('SELECT * FROM verses WHERE book_id=? AND chapter=? AND verse=? AND translation=?').get(book, chapter, verse, translation);
  }
  rangeLabel(range: PassageRange) {
    const first = this.label(range.start);
    if (addressKey(range.start) === addressKey(range.end)) return first;
    const end = range.start.book_id !== range.end.book_id ? this.label(range.end) : range.start.chapter !== range.end.chapter ? `${range.end.chapter}:${range.end.verse}` : String(range.end.verse);
    return `${first}–${end}`;
  }
  passage(range: PassageRange, translation: Translation, limit = 80): Passage {
    const start = addressKey(range.start), end = addressKey(range.end);
    const where = 'translation=? AND book_id BETWEEN ? AND ? AND (book_id*1000000+chapter*1000+verse) BETWEEN ? AND ?';
    const args = [translation, range.start.book_id, range.end.book_id, start, end];
    const verses = this.db.query<Verse, any[]>(`SELECT * FROM verses WHERE ${where} ORDER BY book_id,chapter,verse LIMIT ?`).all(...args, limit);
    const count = this.db.query<{ n: number }, any[]>(`SELECT count(*) n FROM verses WHERE ${where}`);
    const total = count.get(...args)!.n;
    const canonical = count.get('KJV', ...args.slice(1))!.n;
    return { range, label: this.rangeLabel(range), verses, total, omitted: total < canonical || !this.verse(range.start.book_id, range.start.chapter, range.start.verse, translation) || !this.verse(range.end.book_id, range.end.chapter, range.end.verse, translation) };
  }
  crossReferences(range: PassageRange, limit = 1000): { references: CrossReference[]; total: number } {
    if (!this.links) return { references: [], total: 0 };
    const args = [addressKey(range.start), addressKey(range.end)];
    const grouped = 'FROM links WHERE source_key BETWEEN ? AND ? GROUP BY target_start,target_end';
    const total = this.links.query<{ n: number }, number[]>(`SELECT count(*) n FROM (SELECT 1 ${grouped})`).get(...args)!.n;
    const rows = this.links.query<{ target_start: number; target_end: number; votes: number }, number[]>(`SELECT target_start,target_end,max(votes) votes ${grouped} ORDER BY votes DESC,target_start,target_end LIMIT ?`).all(...args, limit);
    return { total, references: rows.map(row => ({ range: { start: decodeAddress(row.target_start), end: decodeAddress(row.target_end) }, votes: row.votes })) };
  }
  search(query: string, translation: Translation, book?: number): SearchResult {
    const fts = literalFts(query);
    if (!fts) return { verses: [], total: 0, counts: new Map() };
    const counts = this.db.query<{ book_id: number; count: number }, [string, string]>(`SELECT v.book_id,count(*) AS count FROM verses_fts JOIN verses v ON v.id=verses_fts.rowid WHERE verses_fts MATCH ? AND v.translation=? GROUP BY v.book_id`).all(fts, translation);
    const where = 'verses_fts MATCH ? AND v.translation=?' + (book ? ' AND v.book_id=?' : '');
    const args = book ? [fts, translation, book] : [fts, translation];
    const verses = this.db.query<Verse, any[]>(`SELECT v.* FROM verses_fts JOIN verses v ON v.id=verses_fts.rowid WHERE ${where} ORDER BY bm25(verses_fts),v.book_id,v.chapter,v.verse LIMIT 400`).all(...args);
    return { verses, total: counts.filter(c => !book || c.book_id === book).reduce((sum, c) => sum + c.count, 0), counts: new Map(counts.map(c => [c.book_id, c.count])) };
  }
  saved(translation: Translation) {
    const refs = this.notes.query<{ book_id: number; chapter: number; verse: number }, []>('SELECT * FROM bookmarks ORDER BY book_id,chapter,verse').all();
    return refs.flatMap(ref => this.verse(ref.book_id, ref.chapter, ref.verse, translation) ?? []);
  }
  isSaved(v: Verse) { return !!this.notes.query('SELECT 1 FROM bookmarks WHERE book_id=? AND chapter=? AND verse=?').get(v.book_id, v.chapter, v.verse); }
  toggleSaved(v: Verse) {
    if (this.isSaved(v)) this.notes.query('DELETE FROM bookmarks WHERE book_id=? AND chapter=? AND verse=?').run(v.book_id, v.chapter, v.verse);
    else this.notes.query('INSERT INTO bookmarks VALUES(?,?,?)').run(v.book_id, v.chapter, v.verse);
  }
  close() { this.links?.close(); this.db.close(); this.notes.close(); }
}
