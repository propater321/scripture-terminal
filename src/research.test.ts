import { afterEach, expect, test as corpusTest } from 'bun:test';
import { BibleStore } from './store';
import { wholeBibleRequest } from './research';
import { parseStudyAnswer } from './study';
import { fuseRanks, HybridSearch, topicKeywords, type BibleSearch } from './search';
import { bookGuides, bookGroups } from './library';
import { missingData } from '../tests/helpers/data';
const test = corpusTest.skipIf(missingData(["bible", "crossrefs"]));
let store: BibleStore;
afterEach(() => store?.close());
const emptySearch: BibleSearch = { async search(query) { return { query, hits: [], mode: 'hybrid', elapsedMs: 1, indexedPassages: 1 }; } };

test('all 66 books have original summaries, themes, valid starting chapters and a unique map group', () => {
  store = new BibleStore(':memory:');
  expect(bookGuides).toHaveLength(66);
  for (const book of store.books) {
    const guide = bookGuides[book.id - 1];
    expect(guide.id).toBe(book.id);
    expect(guide.summary.length).toBeGreaterThan(80);
    expect(guide.themes.length).toBeGreaterThanOrEqual(3);
    expect(guide.highlights.every(h => store.chapter(book.id, h.chapter, 'WEB').length > 0)).toBe(true);
    expect(bookGroups.filter(group => book.id >= group.first && book.id <= group.last)).toHaveLength(1);
  }
});
test('keyword extraction preserves quoted phrases and rank fusion rewards independent matches', () => {
  expect(topicKeywords('What does the Bible say about "kingdom of God" and mercy?')).toBe('"kingdom of God" OR "mercy"*');
  expect(topicKeywords('*** " : AND OR')).toBe('');
  const fused = fuseRanks([{ id: 1 }, { id: 2 }], [{ id: 3 }, { id: 2 }]);
  expect(fused[0].id).toBe(2);
  expect(fused[0].channels).toEqual(['keyword', 'semantic']);
  expect(new Set(fused.map(row => row.id)).size).toBe(3);
});
test('missing semantic data explicitly falls back to working keyword retrieval', async () => {
  store = new BibleStore(':memory:');
  const search = new HybridSearch(store, '/tmp/scripture-missing-semantic.sqlite');
  try {
    const found = await search.search('What does the Bible say about anxious thoughts?', 'WEB');
    expect(found.mode).toBe('keyword'); expect(found.notice).toContain('Keyword results only');
    expect(found.hits.length).toBeGreaterThan(0);
    expect(found.hits.every(hit => hit.channels.join() === 'keyword')).toBe(true);
    const filtered = await search.search('love', 'KJV', { book: 43 });
    expect(filtered.hits.every(hit => hit.range.start.book_id === 43 && hit.translation === 'KJV')).toBe(true);
    await expect(search.search('anxiety', 'WEB', { mode: 'semantic' })).rejects.toThrow('Semantic index');
    await expect(search.search('love', 'WEB', { signal: AbortSignal.abort() })).rejects.toThrow();
  } finally { search.close(); }
});
test('agent reads register actual verses, preserve omissions and validate source IDs', async () => {
  store = new BibleStore(':memory:');
  const request = await wholeBibleRequest(store, emptySearch, 'What does forgiveness mean?', 'WEB', new AbortController().signal, () => {});
  expect(request.scope).toBe('bible'); expect(request.sources).toHaveLength(0);
  const read = await request.tools!.call('bible_read', { reference: 'Matthew 6:9-15' }) as any;
  expect(read.sources).toHaveLength(7);
  expect(read.sources[0].text).toBe(store.verse(40, 6, 9, 'WEB')!.text);
  await request.tools!.call('bible_read', { reference: 'Matthew 6:9-15' });
  expect(request.sources).toHaveLength(7);
  const missing = await request.tools!.call('bible_read', { reference: 'Acts 8:37' }) as any;
  expect(missing.omittedVerses).toBe(true); expect(missing.sources).toHaveLength(0);
  const available = await request.tools!.call('bible_read', { reference: 'Acts 8:37', translation: 'KJV' }) as any;
  expect(available.sources).toHaveLength(1);
  const answer = parseStudyAnswer(JSON.stringify({ answer: 'Forgiveness is part of the prayer [S1].', citations: ['S1'], insufficientEvidence: false }), request);
  expect(answer.sources[0].verse.book_id).toBe(40);
  expect(() => parseStudyAnswer(JSON.stringify({ answer: 'A claim [S900].', citations: ['S900'], insufficientEvidence: false }), request)).toThrow();
  await expect(request.tools!.call('shell', { command: 'pwd' })).rejects.toThrow('Unknown Bible tool');
  await expect(request.tools!.call('bible_search', { query: 'love', book_id: 999 })).rejects.toThrow('Book ID');
});
test('insufficient evidence may be stated without fabricated citations; tool budgets and cancellation hold', async () => {
  store = new BibleStore(':memory:');
  const controller = new AbortController();
  const request = await wholeBibleRequest(store, emptySearch, 'Who printed this edition?', 'WEB', controller.signal, () => {});
  expect(parseStudyAnswer(JSON.stringify({ answer: 'The installed Bible text does not identify that.', citations: [], insufficientEvidence: true }), request).sources).toHaveLength(0);
  expect(() => parseStudyAnswer(JSON.stringify({ answer: 'An unsupported assertion.', citations: [], insufficientEvidence: false }), request)).toThrow();
  for (let i = 0; i < 8; i++) await request.tools!.call('bible_connections', { reference: 'John 3:16' });
  await expect(request.tools!.call('bible_read', { reference: 'John 3:16' })).rejects.toThrow('budget');
  controller.abort();
  await expect(request.tools!.call('bible_search', { query: 'love' })).rejects.toThrow();
});

test('agent can read ranges across chapters and books; citation ranges include every referenced source', async () => {
  store = new BibleStore(':memory:');
  const request = await wholeBibleRequest(store, emptySearch, 'Compare connected passages.', 'WEB', new AbortController().signal, () => {});
  const chapterRange = await request.tools!.call('bible_read', { reference: 'Mark 3:35-4:2' }) as any;
  expect(chapterRange.sources.map((source: any) => source.reference)).toEqual(['Mark 3:35 · WEB', 'Mark 4:1 · WEB', 'Mark 4:2 · WEB']);
  const bookRange = await request.tools!.call('bible_read', { reference: 'Genesis 50:26-Exodus 1:1' }) as any;
  expect(bookRange.sources).toHaveLength(2);
  const answer = parseStudyAnswer(JSON.stringify({ answer: 'The passage crosses a chapter boundary [S1–S3].', citations: ['S1'], insufficientEvidence: false }), request);
  expect(answer.sources).toHaveLength(3);
  const capped = await request.tools!.call('bible_read', { reference: 'Psalm 119' }) as any;
  expect(capped.truncated).toBe(true); expect(capped.availableVerses).toBe(176); expect(capped.sources).toHaveLength(60);
  await expect(request.tools!.call('bible_read', { reference: 'John 4:2-3:16' })).rejects.toThrow('reversed');
});
