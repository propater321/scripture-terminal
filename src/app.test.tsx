import { afterEach, describe, expect, test as corpusTest } from 'bun:test';
import { act } from 'react';
import { testRender } from '@opentui/react/test-utils';
import { App, type Mode } from './app';
import { BibleStore } from './store';
import type { StudyAssistant, StudyRequest } from './study';
import type { BibleSearch } from './search';
import { missingData } from '../tests/helpers/data';
const test = corpusTest.skipIf(missingData(["bible", "crossrefs"]));

let store: BibleStore;
let t: Awaited<ReturnType<typeof testRender>> | undefined;
afterEach(async () => {
  if (t) { await act(async () => { await t!.dispose(); }); t = undefined; }
  store?.close();
});
async function start(mode: Mode = 'study', width = 140, height = 44, assistant?: StudyAssistant, search?: BibleSearch) {
  store = new BibleStore(':memory:');
  t = await testRender(<App store={store} initialMode={mode} assistant={assistant} search={search} />, { width, height });
  await settle();
}
async function settle() { await act(async () => { await new Promise(r => setTimeout(r, 45)); await t!.renderOnce(); }); }
async function key(k: string) {
  await act(async () => {
    t!.mockInput.pressKey(k);
    // A lone Escape waits for the terminal parser's escape-sequence timeout.
    if (k === 'ESCAPE') await new Promise(r => setTimeout(r, 100));
  });
  await settle();
}
async function query(value: string) {
  await key('/');
  await act(async () => { await t!.mockInput.typeText(value); });
  await settle();
  await key('RETURN');
}
const frame = () => t!.captureCharFrame();

function cellColor(x: number, y: number, channel: 'bg' | 'fg' = 'bg') {
  let column = 0;
  for (const span of t!.captureSpans().lines[y].spans) {
    if (x < column + span.width) return JSON.stringify(span[channel]);
    column += span.width;
  }
  throw new Error(`No rendered cell at ${x}, ${y}`);
}
async function hover(x: number, y: number) {
  await act(async () => { await t!.mockMouse.moveTo(x, y); }); await settle();
}

describe('Passage explorer', () => {
  test('hover previews a whole range; following and going back synchronize the reader and retain the trail', async () => {
    await start('workspace'); await query('John 1:5'); await key('x'); await key('g');
    expect(frame()).toContain('● John 1:5');
    expect(frame()).toContain('JOHN  1');
    const lines = frame().split('\n');
    const y = lines.findIndex(line => line.includes('├─ John 3:19–20'));
    const x = lines[y].indexOf('John 3:19–20');
    await hover(x, y);
    expect(frame()).toContain('PREVIEW · John 3:19–20');
    expect(frame()).toContain('3:19');
    expect(frame()).toContain('3:20');
    expect(frame()).toContain('JOHN  1');
    expect(frame()).toContain('● John 1:5');
    await hover(0, 0);
    expect(frame()).toContain('PREVIEW · John 3:19–20');
    await act(async () => { await t!.mockMouse.click(x, y); }); await settle();
    expect(frame()).toContain('● John 3:19–20');
    expect(frame()).toContain('JOHN  3');
    await key('x'); await key('g'); expect(frame()).not.toContain('● John 3:19–20');
    await key('x'); await key('g'); expect(frame()).toContain('● John 3:19–20');
    await key('f'); expect(frame()).not.toContain('● John 3:19–20');
    await key('f'); expect(frame()).toContain('● John 3:19–20');
    await key('?'); expect(frame()).toContain('IN EXPLORE');
    await key('ESCAPE'); expect(frame()).toContain('● John 3:19–20');
    await key('BACKSPACE');
    expect(frame()).toContain('● John 1:5');
    expect(frame()).toContain('JOHN  1');
  });
  test('layers and keyboard navigation work in compact terminals without model calls', async () => {
    let calls = 0;
    await start('workspace', 80, 24, async request => { calls++; return { answer: 'test', sources: [request.sources[0]], model: 'test', plan: 'test' }; });
    await query('John 1:5'); await key('x'); await key('g');
    expect(frame()).toContain('● John 1:5');
    await key('l'); expect(frame()).toContain('Choose Links or Context');
    await key('t'); expect(frame()).toContain('Chapter context');
    await key('ARROW_DOWN'); expect(frame()).toContain('PREVIEW · John 1:4');
    await key('RETURN'); expect(frame()).toContain('● John 1:4');
    await key('BACKSPACE'); expect(frame()).toContain('● John 1:5');
    await key('v'); expect(frame()).toContain('KJV');
    await act(async () => { t!.resize(60, 18); }); await settle();
    expect(frame()).toContain('l Links'); expect(frame()).toContain('t Context');
    expect(frame()).toContain('PREVIEW');
    expect(frame()).toContain('light shineth');
    await key('ESCAPE'); expect(frame()).toContain('JOHN  1');
    expect(calls).toBe(0);
  });
  test('only Explain link submits to Codex, with both passages included as evidence', async () => {
    const requests: StudyRequest[] = [];
    await start('workspace', 140, 44, async request => { requests.push(request); return { answer: 'The passages discuss light [S1].', sources: [request.sources[0]], model: 'test', plan: 'test' }; });
    await query('John 1:5'); await key('x'); await key('g'); await key('ARROW_DOWN');
    expect(requests).toHaveLength(0);
    await key('i');
    expect(frame()).toContain('ASK SCRIPTURE');
    expect(requests).toHaveLength(1);
    expect(requests[0].question).toContain('John 3:19–20');
    expect(requests[0].sources.some(source => source.verse.book_id === 43 && source.verse.chapter === 3 && source.verse.verse === 20)).toBe(true);
    expect(requests[0].sources.some(source => source.verse.book_id === 43 && source.verse.chapter === 1 && source.verse.verse === 5)).toBe(true);
    await key('ESCAPE'); expect(frame()).toContain('● John 1:5');
  });
  test('Atlas selection updates Explore and can be retraced', async () => {
    await start('workspace'); await query('John 1:5'); await key('x'); await key('g'); await key('a');
    expect(frame()).toContain('ATLAS  /');
    const lines = frame().split('\n');
    const y = lines.findIndex(line => line.includes('OT') && line.includes('Gen'));
    const x = lines[y].indexOf('Gen');
    await act(async () => { await t!.mockMouse.click(x, y); }); await settle();
    expect(frame()).toContain('● Genesis 1:1');
    await key('a'); expect(frame()).toContain('● Genesis 1:1');
    await key('BACKSPACE'); expect(frame()).toContain('● John 1:5');
  });
  test('pagination and reader focus preserve the trail even after searching', async () => {
    await start('workspace'); await query('light'); await key('x'); await key('g');
    await query('John 1:5');
    await key('n'); expect(frame()).toContain('2/2');
    await key('p'); expect(frame()).toContain('1/2');
    await key('TAB'); await key('ARROW_DOWN');
    expect(frame()).toContain('● John 1:6');
    await key('ARROW_DOWN'); expect(frame()).toContain('● John 1:7');
    await key('BACKSPACE'); expect(frame()).toContain('● John 1:6');
  });
  test('Explain labels chapter context without attributing it to the cross-reference dataset', async () => {
    const requests: StudyRequest[] = [];
    await start('workspace', 100, 30, async request => { requests.push(request); return { answer: 'Context [S1].', sources: [request.sources[0]], model: 'test', plan: 'test' }; });
    await key('x'); await key('g'); await key('l'); await key('t'); await key('ARROW_DOWN'); await key('i');
    expect(requests).toHaveLength(1);
    expect(requests[0].question).toContain('adjacent chapter context');
    expect(requests[0].question).not.toContain('OpenBible.info lists');
  });
  test('missing cross-reference data still allows chapter-context exploration', async () => {
    store = new BibleStore(':memory:', '/tmp/scripture-no-such-crossrefs.sqlite');
    t = await testRender(<App store={store} initialExplore />, { width: 100, height: 30 }); await settle(); await key('g');
    expect(frame()).toContain('Cross-references are not');
    expect(frame()).toContain('installed.');
    await key('l'); await key('t'); await key('ARROW_DOWN');
    expect(frame()).toContain('PREVIEW · John 1:2');
    await key('RETURN'); expect(frame()).toContain('● John 1:2');
  });
});

test('mouse hover gives reversible feedback without activating controls or changing the selected passage', async () => {
  await start('workspace');
  let lines = frame().split('\n');
  let y = lines.findIndex(line => line.includes('a Atlas'));
  let x = lines[y].indexOf('a Atlas');
  const before = frame(), buttonColor = cellColor(x, y);
  await hover(x, y);
  const hoverColor = cellColor(x, y);
  expect(hoverColor).not.toBe(buttonColor);
  expect(frame()).toBe(before);
  // Moving between the text and padding stays inside the same clickable control.
  await hover(x - 1, y);
  expect(cellColor(x, y)).toBe(hoverColor);
  await hover(0, 0);
  expect(cellColor(x, y)).toBe(buttonColor);

  lines = frame().split('\n');
  y = lines.findIndex(line => line.includes('The same was in the beginning'));
  x = lines[y].indexOf('The same was');
  const verseColor = cellColor(x, y);
  await hover(x, y);
  expect(cellColor(x, y)).not.toBe(verseColor);
  expect(frame()).toBe(before);
  await act(async () => { await t!.mockMouse.click(x, y); }); await settle();
  expect(frame()).toContain('John 1:2');
  await hover(0, 0);
  const selectedColor = cellColor(x, y);
  expect(selectedColor).not.toBe(verseColor);
  await hover(x, y);
  expect(cellColor(x, y)).not.toBe(selectedColor);
  await hover(0, 0);
  expect(cellColor(x, y)).toBe(selectedColor);

  await key('a');
  lines = frame().split('\n');
  y = lines.findIndex(line => line.includes('OT') && line.includes('Gen'));
  x = lines[y].indexOf('Gen');
  const atlasFrame = frame(), heatColor = cellColor(x, y);
  await hover(x, y);
  expect(cellColor(x, y)).not.toBe(heatColor);
  expect(frame()).toBe(atlasFrame);
  await hover(0, 0);
  expect(cellColor(x, y)).toBe(heatColor);

  const borderColor = cellColor(2, 4, 'fg');
  await hover(10, 5);
  expect(cellColor(2, 4, 'fg')).not.toBe(borderColor);
  expect(frame()).toBe(atlasFrame);
  await hover(0, 0);
  expect(cellColor(2, 4, 'fg')).toBe(borderColor);
});

describe('Subscription Ask panel', () => {
  test('opening is free of inference; a submitted question uses the selected context and sources navigate', async () => {
    const requests: StudyRequest[] = [];
    const assistant: StudyAssistant = async request => {
      requests.push(request);
      return { answer: 'God loves the world [S1].', sources: [request.sources[0]], model: 'test-codex', plan: 'test' };
    };
    await start('workspace', 140, 44, assistant);
    await query('John 3:16'); await key('i'); await key('ESCAPE'); await key('p'); await key('e');
    expect(frame()).toContain('ASK SCRIPTURE');
    expect(frame()).not.toContain('PARALLEL TEXT');
    expect(requests).toHaveLength(0);
    await act(async () => { await t!.mockInput.typeText('What does this mean?'); }); await settle();
    await key('RETURN');
    expect(requests).toHaveLength(1);
    expect(requests[0].question).toBe('What does this mean?');
    expect(requests[0].passage).toBe('John 3:16 · WEB');
    expect(frame()).toContain('God loves the world [S1].');
    await key(']');
    expect(frame()).toContain('JOHN  4');
    const lines = frame().split('\n');
    const y = lines.findIndex(line => line.includes('[S1] John 3:16'));
    const x = lines[y].indexOf('[S1] John 3:16');
    await act(async () => { await t!.mockMouse.click(x + 1, y); }); await settle();
    expect(frame()).toContain('JOHN  3');
    await key('f'); expect(frame()).not.toContain('ASK SCRIPTURE');
    await key('f'); expect(frame()).toContain('God loves the world [S1].');
    await key('c'); expect(frame()).toContain('PARALLEL TEXT');
    expect(requests).toHaveLength(1);
  });
  test('compact Ask handles errors and cancellation without letting late answers replace state', async () => {
    let signal: AbortSignal | undefined;
    let finish: ((answer: any) => void) | undefined;
    let attempt = 0;
    const assistant: StudyAssistant = async (_request, currentSignal) => {
      if (++attempt === 1) throw new Error('Your Codex usage limit was reached.');
      signal = currentSignal;
      return await new Promise(resolve => { finish = resolve; });
    };
    await start('workspace', 80, 24, assistant);
    await key('i'); await key('ESCAPE'); await key('p'); await key('e');
    await act(async () => { await t!.mockInput.typeText('Explain this verse'); }); await settle();
    await key('RETURN');
    expect(frame()).toContain('Your Codex usage limit was reached.');
    await key('e'); await key('RETURN');
    expect(frame()).toContain('Stop  [Esc]');
    await key('ESCAPE');
    expect(signal?.aborted).toBe(true);
    await act(async () => { finish?.({ answer: 'A late answer', sources: [], model: 'test', plan: 'test' }); }); await settle();
    expect(frame()).not.toContain('A late answer');
    expect(frame()).toContain('Stopped.');
    await key('ESCAPE'); expect(frame()).toContain('JOHN  1');
  });
  test('compact answers scroll to their sources with the actual Page Down sequence', async () => {
    await start('workspace', 80, 24, async request => ({
      answer: Array.from({ length: 15 }, (_, i) => `Explanation paragraph ${i + 1}, with a source [S1].`).join('\n\n'),
      sources: [request.sources[0]], model: 'test', plan: 'test',
    }));
    await key('i'); await key('ESCAPE'); await key('p'); await key('e');
    await act(async () => { await t!.mockInput.typeText('Explain this verse'); }); await settle();
    await key('RETURN');
    expect(frame()).toContain('Explanation paragraph 1,');
    for (let i = 0; i < 5; i++) await key('\x1b[6~');
    expect(frame()).toContain('VERSE SOURCES');
    expect(frame()).toContain('[S1] John 1:1');
    await key('\x1b[5~');
    expect(frame()).not.toContain('VERSE SOURCES');
  });
  test('disposing the app aborts a pending Codex request', async () => {
    let signal: AbortSignal | undefined;
    await start('workspace', 140, 44, async (_request, currentSignal) => {
      signal = currentSignal;
      return await new Promise((_resolve, reject) => currentSignal.addEventListener('abort', () => reject(new Error('Stopped.')), { once: true }));
    });
    await key('i'); await key('ESCAPE'); await key('p'); await key('e');
    await act(async () => { await t!.mockInput.typeText('Explain this verse'); }); await settle();
    await key('RETURN');
    expect(signal?.aborted).toBe(false);
    await act(async () => { await t!.dispose(); }); t = undefined;
    expect(signal?.aborted).toBe(true);
  });
});

describe('Offline corpus and search', () => {
  test('contains both complete source corpora with distinct version counts', () => {
    store = new BibleStore(':memory:');
    expect(store.books).toHaveLength(66);
    const rows = store.db.query<{ translation: string; n: number }, []>('SELECT translation,count(*) n FROM verses GROUP BY translation').all();
    expect(rows).toEqual([{ translation: 'KJV', n: 31102 }, { translation: 'WEB', n: 31098 }]);
    expect(store.verse(43, 3, 16, 'KJV')!.text).toContain('only begotten Son');
    expect(store.verse(43, 3, 16, 'WEB')!.text).toContain('only born Son');
  });
  test('reference aliases and invalid chapter boundaries', () => {
    store = new BibleStore(':memory:');
    expect(store.parseReference('jn 3:16')?.book.id).toBe(43);
    expect(store.parseReference('1 John 2:1')?.book.id).toBe(62);
    expect(store.parseReference('ps 23')?.chapter).toBe(23);
    expect(() => store.parseReference('John 99:1')).toThrow();
  });
  test('literal punctuation is safe and heatmap totals agree with the corpus', () => {
    store = new BibleStore(':memory:');
    for (const q of ['"', '***', 'AND OR NOT', 'love: mercy?', 'kingdom (of) God']) expect(() => store.search(q, 'WEB')).not.toThrow();
    const all = store.search('mercy', 'WEB');
    expect(all.total).toBe([...all.counts.values()].reduce((a, b) => a + b, 0));
    const filtered = store.search('mercy', 'WEB', 19);
    expect(filtered.total).toBe(all.counts.get(19)!);
    expect(filtered.verses.every(v => v.book_id === 19)).toBe(true);
    expect(store.search('"kingdom of God"', 'WEB').verses.every(v => v.text.toLowerCase().includes('kingdom of god'))).toBe(true);
  });
});

describe('Interactive terminal flows', () => {
  test('combined workspace toggles keep the passage and restore the previous panel arrangement', async () => {
    await start('workspace');
    await query('mercy');
    await key('RETURN');
    await key('a');
    expect(frame()).toContain('ATLAS  /');
    expect(frame()).toContain('PARALLEL TEXT');
    expect(frame()).toContain('SEARCH RESULTS');
    expect(frame()).toContain('JAMES  2');
    await key('f');
    expect(frame()).not.toContain('ATLAS  /');
    expect(frame()).not.toContain('PARALLEL TEXT');
    expect(frame()).not.toContain('SEARCH RESULTS');
    expect(frame()).toContain('JAMES  2');
    expect(frame()).toContain('mercy');
    await key('f');
    expect(frame()).toContain('ATLAS  /');
    expect(frame()).toContain('PARALLEL TEXT');
    expect(frame()).toContain('SEARCH RESULTS');
    await key('a'); await key('c'); await key('r');
    expect(frame()).not.toContain('SEARCH RESULTS');
    await key('f'); await key('f');
    expect(frame()).not.toContain('PARALLEL TEXT');
    expect(frame()).not.toContain('SEARCH RESULTS');
    expect(frame()).toContain('James 2:13');
  });
  test('Atlas drawer mouse filtering updates the shared reader and survives closing the drawer', async () => {
    await start('workspace');
    await query('mercy'); await key('RETURN');
    let lines = frame().split('\n');
    let y = lines.findIndex(l => l.includes('a Atlas'));
    let x = lines[y].indexOf('a Atlas');
    await act(async () => { await t!.mockMouse.click(x + 1, y); }); await settle();
    expect(frame()).toContain('ATLAS  /');
    lines = frame().split('\n');
    y = lines.findIndex(l => l.includes('Ps   20')); x = lines[y].indexOf('Ps   20');
    expect(y).toBeGreaterThan(0);
    await act(async () => { await t!.mockMouse.click(x + 1, y); }); await settle();
    expect(frame()).toContain('Psalms  × clear');
    expect(frame()).toContain('PSALMS');
    await key('a');
    expect(frame()).not.toContain('ATLAS  /');
    expect(frame()).toContain('Psalms  × clear');
    expect(frame()).toContain('PSALMS');
    await key('v');
    expect(frame()).toContain('KJV');
  });
  test('compact combined workspace opens each panel and returns to the same passage', async () => {
    await start('workspace', 80, 24);
    await query('John 3:16');
    await key('c'); expect(frame()).toContain('PARALLEL TEXT');
    await key('c'); expect(frame()).toContain('JOHN  3');
    await key('a'); expect(frame()).toContain('THE CANON');
    await key('a'); expect(frame()).toContain('JOHN  3');
    await key('r'); expect(frame()).toContain('LIBRARY');
    await key('RETURN'); expect(frame()).toContain('JOHN  3');
    await key('f'); expect(frame()).toContain('JOHN  3');
    await key('f'); expect(frame()).toContain('JOHN  3');
  });
  test('jump, navigate chapter, switch translation, and retain context across layouts', async () => {
    await start();
    await query('John 3:16');
    expect(frame()).toContain('John 3:16');
    expect(frame()).toContain('only born Son');
    await key('v');
    expect(frame()).toContain('KJV');
    expect(frame()).toContain('only begotten Son');
    await key('2');
    expect(frame()).toContain('/ READER');
    expect(frame()).toContain('John 3:16');
    await key(']');
    expect(frame()).toContain('JOHN  4');
    await key('[');
    expect(frame()).toContain('JOHN  3');
  });
  test('phrase search, result selection, saved passage, and empty results', async () => {
    await start();
    await query('"kingdom of God"');
    expect(frame()).toContain('SEARCH RESULTS');
    await key('ARROW_DOWN');
    await key('RETURN');
    await key('b');
    expect(store.saved('WEB')).toHaveLength(1);
    await key('s');
    expect(frame()).toContain('SAVED PASSAGES');
    await key('b');
    expect(store.saved('WEB')).toHaveLength(0);
    expect(frame()).toContain('Your saved passages');
    await query('zzznomatchingword');
    expect(frame()).toContain('No matching verses');
  });
  test('all Atlas books fit; click a tile to filter and open a result in Reader', async () => {
    await start('atlas');
    expect(frame()).toContain('Rev');
    const lines = frame().split('\n');
    const y = lines.findIndex(l => l.includes('Ps   20'));
    const x = lines[y].indexOf('Ps   20');
    expect(y).toBeGreaterThan(0);
    await act(async () => { await t!.mockMouse.click(x + 1, y); }); await settle();
    expect(frame()).toContain('Psalms  × clear');
    await key('RETURN');
    expect(frame()).toContain('/ READER');
    expect(frame()).toContain('PSALMS');
  });
  test('invalid references remain editable and escaping restores navigation', async () => {
    await start();
    await query('John 99:1');
    expect(frame()).toContain('outside this book');
    await key('ESCAPE');
    await query('Gen 1:1');
    expect(frame()).toContain('GENESIS  1');
    await key('[');
    expect(frame()).toContain('GENESIS  1');
  });
  test('translation switching reports omitted verses instead of silently changing the reference', async () => {
    await start();
    await key('v');
    await query('Acts 8:37');
    expect(frame()).toContain('Acts 8:37');
    await key('v');
    expect(frame()).toContain('Verse 37 is absent in WEB');
    expect(frame()).toContain('Acts 8:38');
  });
  test('compact layout keeps search and navigation accessible, then expands', async () => {
    await start('study', 80, 24);
    expect(frame()).toContain('JOHN  1');
    await query('mercy');
    expect(frame()).toContain('SEARCH RESULTS');
    await key('RETURN');
    expect(frame()).toContain('JAMES');
    await act(async () => { t!.resize(140, 44); }); await settle();
    expect(frame()).toContain('PARALLEL TEXT');
    await key('?'); expect(frame()).toContain('A FEW KEYS');
    await key('ESCAPE'); expect(frame()).toContain('PARALLEL TEXT');
  });
});

describe('Visual library and whole-Bible topics', () => {
  test('book map previews summaries without moving the reader, then opens a chapter', async () => {
    await start('workspace', 140, 44); await key('x');
    expect(frame()).toContain('THE WHOLE LIBRARY');
    expect(frame()).toContain('OLD TESTAMENT'); expect(frame()).toContain('NEW TESTAMENT');
    expect(frame()).toContain('THEMES TO FOLLOW');
    expect(frame()).toContain('Genesis'); expect(frame()).toContain('Deuteronomy');
    let lines = frame().split('\n');
    const y = lines.findIndex(line => line.includes('Gen') && line.includes('Exod'));
    const x = lines[y].indexOf('Exod');
    await hover(x, y);
    expect(frame()).toContain('EXODUS');
    expect(frame()).toContain('John 1:1');
    await act(async () => { await t!.mockMouse.click(x, y); }); await settle();
    lines = frame().split('\n');
    const readY = lines.findIndex(line => line.includes('Read Exodus'));
    await act(async () => { await t!.mockMouse.click(lines[readY].indexOf('Read Exodus') + 1, readY); }); await settle();
    expect(frame()).toContain('EXODUS  1');
    expect(frame()).not.toContain('THE WHOLE LIBRARY');
  });
  test('compact book overview remains usable down to 60 columns and opens scripture', async () => {
    await start('workspace', 60, 18); await key('x');
    expect(frame()).toContain('66 books'); expect(frame()).toContain('Books [o]');
    await key('RETURN'); expect(frame()).toContain('GENESIS');
    expect(frame()).toContain('Creation');
    await key('BACKSPACE'); expect(frame()).toContain('THE WHOLE LIBRARY');
    await key('RETURN'); await key('RETURN');
    expect(frame()).toContain('GENESIS  1');
    expect(frame()).toContain('In the beginning, God created');
    expect(frame()).toContain('← Books');
    await key('BACKSPACE'); expect(frame()).toContain('GENESIS');
    expect(frame()).toContain('Read Genesis 1');
  });
  test('book finder, testament filters and chapter picker lead to reading and preserve the return path', async () => {
    await start('workspace', 100, 30); await key('x');
    let lines = frame().split('\n');
    let y = lines.findIndex(line => line.includes('New 27'));
    await act(async () => { await t!.mockMouse.click(lines[y].indexOf('New 27') + 1, y); }); await settle();
    expect(frame()).toContain('NEW TESTAMENT'); expect(frame()).not.toContain('OLD TESTAMENT');
    await key('/'); await act(async () => { await t!.mockInput.typeText('psalms'); }); await settle();
    expect(frame()).toContain('1 book found'); expect(frame()).toContain('Psalms');
    expect(frame()).not.toContain('SEARCH RESULTS');
    await key('RETURN'); await key('h');
    expect(frame()).toContain('Choose a chapter to read');
    await key('ARROW_RIGHT'); await key('ARROW_DOWN');
    expect(frame()).toContain('Read Psalms 9');
    await key('RETURN'); expect(frame()).toContain('PSALMS  9');
    lines = frame().split('\n'); y = lines.findIndex(line => line.includes('← Books'));
    await act(async () => { await t!.mockMouse.click(lines[y].indexOf('← Books') + 1, y); }); await settle();
    expect(frame()).toContain('Read Psalms 9'); expect(frame()).toContain('Choose a chapter');
    await key('ESCAPE'); await key('ESCAPE'); await key('/');
    await act(async () => { await t!.mockInput.typeText('not a book'); }); await settle();
    expect(frame()).toContain('No books match');
    lines = frame().split('\n'); y = lines.findIndex(line => line.includes('Clear'));
    await act(async () => { await t!.mockMouse.click(lines[y].indexOf('Clear') + 1, y); }); await settle();
    expect(frame()).toContain('66 books');
  });
  test('primary navigation stays in its selected view and topic Search works by mouse without AI', async () => {
    const queries: string[] = [];
    const search: BibleSearch = { async search(query) { queries.push(query); return { query, mode: 'keyword', hits: [], indexedPassages: 0, elapsedMs: 1 }; } };
    await start('workspace', 60, 18, undefined, search); await key('x');
    async function clickText(label: string) {
      const lines = frame().split('\n'), y = lines.findIndex(line => line.includes(label));
      expect(y).toBeGreaterThanOrEqual(0);
      await act(async () => { await t!.mockMouse.click(lines[y].indexOf(label) + 1, y); }); await settle();
    }
    await clickText('Explore [x]'); expect(frame()).toContain('THE WHOLE LIBRARY');
    await clickText('Topics [u]'); await key('\x1b[6~');
    expect(frame()).toContain('Relationships');
    await key('/');
    const question = 'What does the Bible say about forgiving someone who has hurt me and finding peace?';
    await act(async () => { await t!.mockInput.typeText(question); }); await settle();
    await clickText('Search'); expect(queries).toEqual([question]);
    expect(frame()).toContain('No candidate passages');
    await clickText('Read'); expect(frame()).toContain('JOHN  1');
    await clickText('Explore [x]'); expect(frame()).toContain('No candidate passages');
  });
  test('topic input searches without AI; asking uses whole-Bible tools and preserves topic results', async () => {
    const queries: string[] = [], requests: StudyRequest[] = [];
    const refinements: boolean[] = [];
    const search: BibleSearch = { async search(query, translation, options) {
      queries.push(query);
      refinements.push(options?.rerank === true);
      const range = { start: { book_id: 40, chapter: 6, verse: 25 }, end: { book_id: 40, chapter: 6, verse: 29 } };
      return { query, mode: 'hybrid', reranked: options?.rerank, elapsedMs: 1, indexedPassages: 20727, hits: [{ id: 1, label: 'Matthew 6:25–29', range, translation, text: store.passage(range, translation).verses.map(v => v.text).join(' '), score: 1, channels: ['keyword', 'semantic'] }] };
    } };
    await start('workspace', 140, 44, async request => {
      requests.push(request);
      await request.tools!.call('bible_read', { reference: 'Philippians 4:4-9' });
      return { answer: 'The passages address worry and prayer [S1].', sources: [request.sources[0]], model: 'test', plan: 'test', searches: request.searches };
    }, search);
    await key('x'); await key('u'); await key('/');
    await act(async () => { await t!.mockInput.typeText('anxiety and peace'); }); await settle(); await key('RETURN');
    expect(queries).toEqual(['anxiety and peace']); expect(requests).toHaveLength(0);
    expect(frame()).toContain('Matthew 6:25–29'); expect(frame()).toContain('keywords + meaning');
    await key('z'); expect(refinements).toEqual([false, true]); expect(frame()).toContain('· refined');
    expect(requests).toHaveLength(0);
    await key('i');
    expect(requests).toHaveLength(1); expect(requests[0].scope).toBe('bible');
    expect(requests[0].sources.some(source => source.verse.book_id === 50)).toBe(true);
    expect(requests[0].sources.some(source => source.verse.book_id === 43)).toBe(false);
    expect(frame()).toContain('Whole Bible');
    await key('ESCAPE'); expect(frame()).toContain('Matthew 6:25–29');
    await key('g'); expect(frame()).toContain('● Matthew 6:25–29');
  });
  test('new topic searches abort earlier ones and ignore late results', async () => {
    const pending: { query: string; translation: string; signal?: AbortSignal; resolve(value: any): void }[] = [];
    const search: BibleSearch = { async search(query, translation, options) { return new Promise(resolve => pending.push({ query, translation, signal: options?.signal, resolve })); } };
    await start('workspace', 80, 24, undefined, search);
    await key('x'); await key('u'); await key('/');
    await act(async () => { await t!.mockInput.typeText('first topic'); }); await key('RETURN');
    expect(frame()).toContain('Searching words and meaning');
    await key('/'); await act(async () => { await t!.mockInput.typeText('second topic'); }); await key('RETURN');
    expect(pending.map(request => request.query)).toEqual(['first topic', 'second topic']);
    expect(pending[0].signal?.aborted).toBe(true);
    await act(async () => { pending[0].resolve({ query: 'first topic', hits: [], mode: 'keyword', notice: 'OBSOLETE RESULT', elapsedMs: 1, indexedPassages: 1 }); }); await settle();
    expect(frame()).not.toContain('OBSOLETE RESULT');
    await key('v');
    expect(pending[1].signal?.aborted).toBe(true);
    expect(pending[2].query).toBe('second topic');
    expect(pending[2].translation).toBe('KJV');
    await key('ESCAPE'); expect(pending[2].signal?.aborted).toBe(true);
  });
});
