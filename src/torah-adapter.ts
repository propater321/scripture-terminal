import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { BibleStore, literalFts, type ScriptureStore, type LibraryProfile, type Translation, type Verse, type Book } from './store';
import { TorahStore, normalizeTorahSearch, type TorahEdition } from './torah-store';
import { addressKey, type PassageRange } from './references';

/** The same workspace API, backed exclusively by Sefaria-numbered Torah data. */
export class TorahAdapter implements ScriptureStore {
  readonly profile: LibraryProfile = { id: 'torah', name: 'Torah', editions: ['jps1917', 'hebrew'], defaultEdition: 'jps1917', sourceFile: 'torah.sqlite', indexFile: 'torah-semantic.sqlite', versionColumn: 'edition', linksSource: 'Sefaria', linksCredit: 'Sefaria Torah connections' };
  readonly db; readonly books: Book[];
  links?: Database; linksError?: string; linksMetadata?: BibleStore['linksMetadata'];
  constructor(readonly torah: TorahStore, linksPath = join(import.meta.dir, '../data/torah-links.sqlite')) {
    this.db = torah.db;
    this.books = torah.books.map((b, i) => ({ ...b, osis: ['Gen', 'Exod', 'Lev', 'Num', 'Deut'][i], testament: 'Torah' }));
    if (existsSync(linksPath)) {
      try { this.links = new Database(linksPath, { readonly: true }); this.linksMetadata = JSON.parse(this.links.query<{json:string},[]>('SELECT json FROM metadata').get()!.json); }
      catch { this.links?.close(); this.links = undefined; this.linksError = 'Torah connections could not be opened. Run bun run import:torah-links.'; }
    } else this.linksError = 'Install Torah connections with bun run import:torah-links.';
  }
  private edition(value: Translation): TorahEdition { if (value !== 'hebrew' && value !== 'jps1917') throw new Error('Choose Hebrew or JPS 1917 for Torah.'); return value; }
  book(id: number) { const book = this.books.find(b => b.id === id); if (!book) throw new Error('Choose one of the five Torah books.'); return book; }
  label = BibleStore.prototype.label;
  rangeLabel = BibleStore.prototype.rangeLabel;
  crossReferences = BibleStore.prototype.crossReferences;
  parseReference(query: string) {
    const parts = query.trim().split(/[-–]/u); if (parts.length > 2) throw new Error('Use one passage range.');
    // Permit the same short book names shown in Atlas.
    const value = parts[0].replace(/^(Gen|Exod|Lev|Num|Deut)\.?\s+(?=\d)/i, (_, short) => this.books.find(b => b.osis.toLowerCase() === short.toLowerCase())!.name + ' ');
    const ref = this.torah.parseReference(value); if (!ref) return null;
    const end = parts[1] === undefined ? undefined : Number(parts[1]);
    if (end !== undefined && (!Number.isInteger(end) || end < ref.verse || !this.torah.verse({...ref, verse: end}, 'hebrew'))) throw new Error('Invalid Torah verse range.');
    return { book: this.book(ref.book_id), chapter: ref.chapter, verse: ref.verse, end };
  }
  chapter(book: number, chapter: number, translation: Translation): Verse[] { return this.torah.chapter(book, chapter, this.edition(translation)).map(v => ({ ...v, translation })); }
  verse(book: number, chapter: number, verse: number, translation: Translation): Verse | null { const v = this.torah.verse({book_id: book, chapter, verse}, this.edition(translation)); return v ? { ...v, translation } : null; }
  passage(range: PassageRange, translation: Translation, limit = 80) {
    this.edition(translation);
    const args = [translation, addressKey(range.start), addressKey(range.end)];
    const where = 'edition=? AND (book_id*1000000+chapter*1000+verse) BETWEEN ? AND ?';
    const verses = this.db.query<Verse,any[]>(`SELECT id,edition AS translation,book_id,chapter,verse,text FROM verses WHERE ${where} ORDER BY book_id,chapter,verse LIMIT ?`).all(...args, limit);
    const total = this.db.query<{n:number},any[]>(`SELECT count(*) n FROM verses WHERE ${where}`).get(...args)!.n;
    return { range, label: this.rangeLabel(range), verses, total, omitted: !this.verse(range.start.book_id,range.start.chapter,range.start.verse,translation) || !this.verse(range.end.book_id,range.end.chapter,range.end.verse,translation) };
  }
  search(query: string, translation: Translation, book?: number) {
    this.edition(translation); const fts = literalFts(normalizeTorahSearch(query));
    if (!fts) return { verses: [], total: 0, counts: new Map<number, number>() };
    const where = 'FROM verses_fts JOIN verses v ON v.id=verses_fts.rowid WHERE verses_fts MATCH ? AND v.edition=?';
    const counts = this.db.query<{book_id:number;n:number},any[]>(`SELECT v.book_id,count(*) n ${where} GROUP BY v.book_id`).all(fts, translation);
    const verses = this.db.query<Verse,any[]>(`SELECT v.id,v.edition AS translation,v.book_id,v.chapter,v.verse,v.text ${where} ${book ? 'AND v.book_id=?' : ''} ORDER BY bm25(verses_fts),v.id LIMIT 400`).all(fts, translation, ...(book ? [book] : []));
    return { verses, total: counts.filter(c => !book || c.book_id === book).reduce((sum,c) => sum+c.n,0), counts: new Map(counts.map(c => [c.book_id,c.n])) };
  }
  saved(translation: Translation) { return this.torah.saved().flatMap(v => this.verse(v.book_id,v.chapter,v.verse,translation) ?? []); }
  isSaved(v: Verse) { return this.torah.isSaved(v); }
  toggleSaved(v: Verse) { this.torah.toggleSaved(v); }
  close() { this.links?.close(); }
}
