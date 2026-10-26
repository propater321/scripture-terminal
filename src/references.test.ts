import { afterEach, expect, test as corpusTest } from 'bun:test';
import { BibleStore } from './store';
import { rangeKey, singleVerse, type PassageRange } from './references';
import { missingData } from '../tests/helpers/data';
const test = corpusTest.skipIf(missingData(["bible", "crossrefs"]));
let store: BibleStore;
afterEach(() => store?.close());
const range = (book: number, chapter: number, first: number, last = first): PassageRange => ({ start: { book_id: book, chapter, verse: first }, end: { book_id: book, chapter, verse: last } });

test('the full attributed dataset is queryable and ranges combine links without duplicate targets', () => {
  store = new BibleStore(':memory:');
  expect(store.linksMetadata?.rows).toBe(344799);
  expect(store.linksMetadata?.license).toBe('CC BY 4.0');
  const found = store.crossReferences(range(43, 3, 16));
  expect(found.total).toBeGreaterThan(6);
  expect(found.references.some(link => store.rangeLabel(link.range) === 'Romans 5:8')).toBe(true);
  expect(found.references.some(link => store.rangeLabel(link.range) === '1 John 4:9–10')).toBe(true);
  expect(found.references.every((link, index, all) => index === 0 || all[index - 1].votes >= link.votes)).toBe(true);
  const combined = store.crossReferences(range(43, 3, 16, 17));
  expect(new Set(combined.references.map(link => rangeKey(link.range))).size).toBe(combined.references.length);
});

test('passage previews preserve ranges across chapters and books', () => {
  store = new BibleStore(':memory:');
  const sameChapter = store.passage(range(43, 3, 19, 20), 'WEB');
  expect(sameChapter.label).toBe('John 3:19–20');
  expect(sameChapter.verses.map(v => v.verse)).toEqual([19, 20]);
  const crossChapter = { start: { book_id: 41, chapter: 3, verse: 35 }, end: { book_id: 41, chapter: 4, verse: 2 } };
  expect(store.passage(crossChapter, 'WEB').verses.map(v => `${v.chapter}:${v.verse}`)).toEqual(['3:35', '4:1', '4:2']);
  expect(store.rangeLabel(crossChapter)).toBe('Mark 3:35–4:2');
  const crossBook = { start: { book_id: 1, chapter: 50, verse: 26 }, end: { book_id: 2, chapter: 1, verse: 1 } };
  expect(store.passage(crossBook, 'KJV').verses).toHaveLength(2);
  expect(store.rangeLabel(crossBook)).toBe('Genesis 50:26–Exodus 1:1');
});

test('missing translation verses and capped previews are explicit', () => {
  store = new BibleStore(':memory:');
  expect(store.passage(range(44, 8, 37), 'WEB')).toMatchObject({ total: 0, verses: [], omitted: true });
  expect(store.passage(range(44, 8, 37), 'KJV')).toMatchObject({ total: 1, omitted: false });
  const partial = store.passage(range(44, 8, 36, 38), 'WEB');
  expect(partial.verses.map(v => v.verse)).toEqual([36, 38]);
  expect(partial.omitted).toBe(true);
  const limited = store.passage(range(19, 119, 1, 176), 'WEB');
  expect(limited.verses).toHaveLength(80);
  expect(limited.total).toBe(176);
});

test('reading still works when the optional cross-reference database is missing', () => {
  store = new BibleStore(':memory:', '/tmp/scripture-no-such-crossrefs.sqlite');
  const verse = store.verse(43, 1, 5, 'WEB')!;
  expect(verse.text).toContain('light');
  expect(store.links).toBeUndefined();
  expect(store.crossReferences(singleVerse(verse))).toEqual({ references: [], total: 0 });
});
