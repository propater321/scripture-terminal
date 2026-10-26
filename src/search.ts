import { Database } from 'bun:sqlite';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ScriptureStore, type Translation, type LibraryId } from './store';
import { normalizeTorahSearch } from './torah-store';
import type { PassageRange } from './references';

export type SearchMode = 'hybrid' | 'keyword' | 'semantic';
export type PassageHit = { id: number; label: string; range: PassageRange; translation: Translation; text: string; score: number; channels: ('keyword' | 'semantic')[] };
export type PassageSearch = { query: string; hits: PassageHit[]; mode: SearchMode; reranked?: boolean; notice?: string; elapsedMs: number; indexedPassages: number };
export type SearchOptions = { book?: number; limit?: number; mode?: SearchMode; rerank?: boolean; signal?: AbortSignal };
export interface BibleSearch { search(query: string, translation: Translation, options?: SearchOptions): Promise<PassageSearch>; close?(): void }
type Row = { id: number; translation: Translation; book_id: number; chapter: number; first_verse: number; last_verse: number; label: string; text: string };
type Ranked = { id: number; score?: number };
const root = join(import.meta.dir, '..');
const stopWords = new Set('a an the and or of to in on for from with by as is are was were be been being it its this that these those i me my we our you your he she they their them what which who whom whose when where why how does do did can could should would will about say says bible scripture scriptures teach teaches tell tells please torah את על של מה איך למה הוא היא הם הן זה זו עם כל גם או אשר אל כי מן אם לא'.split(' '));

export function topicKeywords(query: string): string {
  const phrases = [...query.matchAll(/"([^"]+)"/gu)].map(match => match[1]);
  const words = query.replace(/"[^"]*"/g, ' ').match(/[\p{L}\p{N}]+/gu) ?? [];
  return [...phrases.map(p => '"' + (p.match(/[\p{L}\p{N}]+/gu) ?? []).join(' ') + '"'), ...words.filter(w => w.length > 1 && !stopWords.has(w.toLowerCase())).slice(0, 20).map(w => `"${w}"*`)].filter(s => s !== '""').join(' OR ');
}

export function fuseRanks(keyword: Ranked[], semantic: Ranked[]) {
  const combined = new Map<number, { id: number; score: number; channels: ('keyword' | 'semantic')[] }>();
  for (const [channel, results] of [['keyword', keyword], ['semantic', semantic]] as const) {
    results.forEach((row, rank) => {
      const entry = combined.get(row.id) ?? { id: row.id, score: 0, channels: [] };
      if (!entry.channels.includes(channel)) { entry.score += 1 / (60 + rank + 1); entry.channels.push(channel); }
      combined.set(row.id, entry);
    });
  }
  return [...combined.values()].sort((a, b) => b.score - a.score || a.id - b.id);
}

class SemanticWorker {
  private child?: ChildProcessWithoutNullStreams;
  private ready?: Promise<void>;
  private sequence = 0;
  private stopped = false;
  private pending = new Map<number, { resolve: (rows: Ranked[]) => void; reject: (error: Error) => void; cleanup: () => void }>();
  private onExit = () => { this.child?.kill('SIGTERM'); };
  constructor(private library: LibraryId) { process.once('exit', this.onExit); }
  private start() {
    if (this.stopped) throw new Error('Search is closed.');
    if (this.ready) return this.ready;
    this.ready = new Promise<void>((resolve, reject) => {
      let initialized = false;
      const timer = setTimeout(() => { reject(new Error('Local search model took too long to load.')); this.child?.kill(); }, 45_000);
      const fail = (error: Error) => {
        clearTimeout(timer);
        if (!initialized) reject(error);
        for (const request of this.pending.values()) { request.cleanup(); request.reject(error); }
        this.pending.clear();
      };
      const child = this.child = spawn(join(root, '.venv-search/bin/python'), [join(root, 'scripts/search-model.py'), 'worker', '--library', this.library], {
        cwd: root, env: { ...process.env, OMP_NUM_THREADS: '4', OPENBLAS_NUM_THREADS: '1', HF_HUB_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1' }, stdio: ['pipe', 'pipe', 'pipe'],
      });
      child.stderr.on('data', () => {});
      child.stdin.on('error', () => fail(new Error('Local search connection closed.')));
      child.on('error', () => fail(new Error('Local embedding runtime is unavailable. Run bun run setup:search.')));
      child.on('exit', () => { fail(new Error('Local search stopped. Reopen Scripture to retry.')); });
      createInterface({ input: child.stdout }).on('line', line => {
        try {
          const message = JSON.parse(line);
          if (message.ready) { initialized = true; clearTimeout(timer); resolve(); }
          else if (message.fatal) fail(new Error(message.fatal));
          else {
            const pending = this.pending.get(message.id);
            if (!pending) return;
            this.pending.delete(message.id); pending.cleanup();
            if (message.error) pending.reject(new Error(message.error)); else pending.resolve(message.results);
          }
        } catch { fail(new Error('Invalid response from local search.')); }
      });
    });
    return this.ready;
  }
  async search(query: string, translation: Translation, book: number | undefined, signal?: AbortSignal) {
    return this.request({ query, translation, book, limit: 100 }, signal);
  }
  async rerank(query: string, ids: number[], signal?: AbortSignal) {
    return this.request({ method: 'rerank', query, ids }, signal);
  }
  private async request(payload: Record<string, unknown>, signal?: AbortSignal) {
    signal?.throwIfAborted();
    await this.start();
    signal?.throwIfAborted();
    if (this.child?.exitCode !== null || this.stopped) throw new Error('Local search is unavailable. Reopen Scripture.');
    const id = ++this.sequence;
    return new Promise<Ranked[]>((resolve, reject) => {
      const abort = () => { const request = this.pending.get(id); this.pending.delete(id); request?.cleanup(); reject(new DOMException('Stopped.', 'AbortError')); };
      const timer = setTimeout(() => { this.pending.delete(id); signal?.removeEventListener('abort', abort); reject(new Error('Semantic search timed out.')); }, this.library !== 'bible' && payload.method === 'rerank' ? 120_000 : 30_000);
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
      this.pending.set(id, { resolve, reject, cleanup });
      signal?.addEventListener('abort', abort, { once: true });
      this.child!.stdin.write(JSON.stringify({ id, ...payload }) + '\n');
    });
  }
  close() {
    this.stopped = true;
    for (const request of this.pending.values()) { request.cleanup(); request.reject(new DOMException('Stopped.', 'AbortError')); }
    this.pending.clear(); process.removeListener('exit', this.onExit);
    this.child?.stdin.end(); this.child?.kill('SIGTERM');
  }
}

export class HybridSearch implements BibleSearch {
  private db?: Database;
  private metadata?: { format: number; model: string; bible_sha256: string; passages: number };
  private validated?: Promise<boolean>;
  private worker?: SemanticWorker;
  private closed = false;
  constructor(private store: ScriptureStore, indexPath = join(root, 'data', store.profile.indexFile)) {
    if (existsSync(indexPath)) {
      try {
        this.db = new Database(indexPath, { readonly: true });
        this.metadata = JSON.parse(this.db.query<{ json: string }, []>('SELECT json FROM metadata').get()!.json);
      } catch { this.db?.close(); this.db = undefined; }
    }
  }
  private async validIndex() {
    if (!this.db || !this.metadata || this.metadata.format !== 1) return false;
    return this.validated ??= (async () => {
      const bytes = await Bun.file(join(root, 'data', this.store.profile.sourceFile)).arrayBuffer();
      return new Bun.CryptoHasher('sha256').update(bytes).digest('hex') === this.metadata!.bible_sha256;
    })();
  }
  private fallback(query: string, translation: Translation, book: number | undefined, limit: number): PassageHit[] {
    const terms = topicKeywords(this.store.profile.id !== 'bible' ? normalizeTorahSearch(query) : query);
    if (!terms) return [];
    const matchedEdition: Translation = this.store.profile.id === 'bible' ? translation : /[\u0590-\u05ff]/u.test(query) ? this.store.profile.id === 'torah' ? 'hebrew' : 'original' : this.store.profile.id === 'torah' ? 'jps1917' : 'english';
    const rows = this.store.db.query<{ book_id: number; chapter: number; verse: number }, any[]>(`SELECT v.book_id,v.chapter,v.verse FROM verses_fts JOIN verses v ON v.id=verses_fts.rowid WHERE verses_fts MATCH ? AND v.${this.store.profile.versionColumn}=? ${book ? 'AND v.book_id=?' : ''} ORDER BY bm25(verses_fts),v.id LIMIT 100`).all(terms, matchedEdition, ...(book ? [book] : []));
    const seen = new Set<string>();
    return rows.flatMap(row => {
      const key = `${row.book_id}:${row.chapter}`;
      if (seen.has(key)) return [];
      seen.add(key);
      const readingEdition = this.store.verse(row.book_id,row.chapter,row.verse,translation) ? translation : matchedEdition;
      const chapter = this.store.chapter(row.book_id, row.chapter, readingEdition).filter(v=>v.text);
      const i = chapter.findIndex(v => v.verse === row.verse);
      const first = chapter[Math.max(0, i - 2)], last = chapter[Math.min(chapter.length - 1, i + 2)];
      const range = { start: first, end: last };
      return [{ id: first.id, range, label: this.store.rangeLabel(range), translation: readingEdition, text: this.store.passage(range, readingEdition).verses.map(v => v.text).join(' '), score: 1 / (60 + seen.size), channels: ['keyword'] as ('keyword' | 'semantic')[] }];
    }).slice(0, limit);
  }
  async search(query: string, translation: Translation, options: SearchOptions = {}): Promise<PassageSearch> {
    query = query.trim();
    if (!query || query.length > 4000) throw new Error('Enter a topic or question of 1–4,000 characters.');
    if (!this.store.profile.editions.includes(translation)) throw new Error('Unknown translation.');
    if (options.book !== undefined && (!Number.isInteger(options.book) || options.book < 1 || options.book > this.store.books.length)) throw new Error('Unknown book.');
    if (this.closed) throw new Error('Search is closed.');
    options.signal?.throwIfAborted();
    const started = performance.now(), limit = Math.max(1, Math.min(30, options.limit ?? 12)), mode = options.mode ?? 'hybrid';
    const valid = await this.validIndex();
    options.signal?.throwIfAborted();
    if (!valid) {
      if (mode === 'semantic') throw new Error(`Semantic index is unavailable or out of date. Run bun run ${this.store.profile.id === 'bible' ? 'index:semantic' : this.store.profile.id === 'torah' ? 'index:torah' : 'index:jewish'}.`);
      return { query, hits: this.fallback(query, translation, options.book, limit), mode: 'keyword', notice: `Keyword results only. Run bun run ${this.store.profile.id === 'bible' ? 'setup:search and bun run index:semantic' : this.store.profile.id === 'torah' ? 'setup:torah-search and bun run index:torah' : 'index:jewish'} for meaning search.`, elapsedMs: performance.now() - started, indexedPassages: 0 };
    }
    const terms = topicKeywords(this.store.profile.id !== 'bible' ? normalizeTorahSearch(query) : query);
    const keywordSql = this.store.profile.id !== 'bible'
      ? `SELECT coalesce(target.id,p.id) id FROM passages_fts JOIN passages p ON p.id=passages_fts.rowid LEFT JOIN passages target ON target.book_id=p.book_id AND target.chapter=p.chapter AND target.first_verse=p.first_verse AND target.last_verse=p.last_verse AND target.translation=? WHERE passages_fts MATCH ? ${options.book ? 'AND p.book_id=?' : ''} ORDER BY bm25(passages_fts),p.id LIMIT 100`
      : `SELECT p.id FROM passages_fts JOIN passages p ON p.id=passages_fts.rowid WHERE passages_fts MATCH ? AND p.translation=? ${options.book ? 'AND p.book_id=?' : ''} ORDER BY bm25(passages_fts),p.id LIMIT 100`;
    const keyword = mode === 'semantic' || !terms ? [] : this.db!.query<Ranked, any[]>(keywordSql).all(...(this.store.profile.id === 'bible' ? [terms,translation] : [translation,terms]), ...(options.book ? [options.book] : []));
    let semantic: Ranked[] = [], notice: string | undefined;
    let actualMode = mode;
    if (mode !== 'keyword') {
      try { this.worker ??= new SemanticWorker(this.store.profile.id); semantic = await this.worker.search(query, translation, options.book, options.signal); }
      catch (error) { options.signal?.throwIfAborted(); if (mode === 'semantic') throw error; actualMode = 'keyword'; notice = `Keyword results only. ${(error as Error).message}`; }
    }
    options.signal?.throwIfAborted();
    if (this.closed) throw new Error('Search is closed.');
    const hits: PassageHit[] = [];
    const lookup = this.db!.query<Row, [number]>('SELECT id,translation,book_id,chapter,first_verse,last_verse,label,text FROM passages WHERE id=?');
    for (const item of fuseRanks(keyword, semantic)) {
      const row = lookup.get(item.id)!;
      if (hits.some(hit => hit.range.start.book_id === row.book_id && hit.range.start.chapter === row.chapter && hit.range.start.verse <= row.last_verse && hit.range.end.verse >= row.first_verse)) continue;
      hits.push({ ...item, translation: row.translation, label: row.label, text: row.text, range: { start: { book_id: row.book_id, chapter: row.chapter, verse: row.first_verse }, end: { book_id: row.book_id, chapter: row.chapter, verse: row.last_verse } } });
      if (hits.length >= (options.rerank ? 30 : limit)) break;
    }
    let reranked = false;
    if (options.rerank && hits.length && actualMode !== 'keyword') {
      try {
        const refined = await this.worker!.rerank(query, hits.map(hit => hit.id), options.signal);
        const order = new Map(refined.map((row, index) => [row.id, index]));
        hits.sort((a, b) => (order.get(a.id) ?? 1000) - (order.get(b.id) ?? 1000));
        reranked = true;
      } catch (error) { options.signal?.throwIfAborted(); notice = `Refinement unavailable; showing hybrid candidates. ${(error as Error).message}`; }
    }
    return { query, hits: hits.slice(0, limit), mode: actualMode, reranked, notice, elapsedMs: performance.now() - started, indexedPassages: this.metadata!.passages };
  }
  close() { this.closed = true; this.worker?.close(); this.db?.close(); }
}
