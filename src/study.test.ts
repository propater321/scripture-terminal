import { afterEach, expect, test as corpusTest } from 'bun:test';
import { BibleStore } from './store';
import { parseStudyAnswer, studyPrompt, studyRequest } from './study';
import { missingData } from '../tests/helpers/data';
const test = corpusTest.skipIf(missingData(["bible"]));

let store: BibleStore;
afterEach(() => store?.close());

test('study context uses actual chapter text, a parallel verse, and bounded search results', () => {
  store = new BibleStore(':memory:');
  const selected = store.verse(43, 3, 16, 'WEB')!;
  const request = studyRequest(store, selected, ' Explain this. ', 'love');
  expect(request.passage).toBe('John 3:16 · WEB');
  expect(request.question).toBe('Explain this.');
  expect(request.sources[0].verse).toEqual(selected);
  expect(request.sources.filter(s => s.verse.book_id === 43 && s.verse.chapter === 3 && s.verse.translation === 'WEB')).toHaveLength(36);
  expect(request.sources.some(s => s.label === 'John 3:16 · KJV')).toBe(true);
  expect(request.sources.length).toBeLessThanOrEqual(45);
  expect(new Set(request.sources.map(s => s.verse.id)).size).toBe(request.sources.length);
  const sent = JSON.parse(studyPrompt(request));
  expect(sent.sources[0].text).toBe(selected.text);
  expect(sent.sources[0].reference).toBe('John 3:16 · WEB');
});

test('answers resolve source IDs to stored verses and reject fabricated or incomplete citations', () => {
  store = new BibleStore(':memory:');
  const request = studyRequest(store, store.verse(43, 3, 16, 'WEB')!, 'Explain this.');
  const answer = parseStudyAnswer(JSON.stringify({ answer: 'God loves the world [S1].', citations: ['S1', 'S1'] }), request);
  expect(answer.sources).toEqual([request.sources[0]]);
  for (const raw of [
    'not JSON', 'null', '{"answer":"',
    JSON.stringify({ answer: 'No source', citations: [] }),
    JSON.stringify({ answer: 'An unknown source [S999].', citations: ['S1'] }),
    JSON.stringify({ answer: 'An unknown source in a group [S1, S999].', citations: ['S1'] }),
    JSON.stringify({ answer: 'A fabricated source.', citations: ['S999'] }),
  ]) expect(() => parseStudyAnswer(raw, request)).toThrow();
});
