import { afterEach, describe, expect, test as corpusTest } from 'bun:test';
import { act } from 'react';
import { testRender } from '@opentui/react/test-utils';
import { App } from './app';
import { BibleStore } from './store';
import { TorahStore, normalizeTorahSearch } from './torah-store';
import { hebrewDisplay, visualHebrewLine, withHebrewMarks, wrapLogical } from './hebrew';
import { stringWidth } from 'bun';
import { missingData } from '../tests/helpers/data';
const test = corpusTest.skipIf(missingData(["bible", "torah"]));

let torah: TorahStore | undefined, bible: BibleStore | undefined;
let t: Awaited<ReturnType<typeof testRender>> | undefined;
afterEach(async () => { if(t) await act(async()=>{await t!.dispose();});t=undefined;torah?.close();bible?.close();torah=undefined;bible=undefined; });
async function settle() {await act(async()=>{for(let pass=0;pass<3;pass++){await t!.renderOnce();await Bun.sleep(25);}});}
async function key(value:string) {await act(async()=>{t!.mockInput.pressKey(value);if(value==='ESCAPE')await Bun.sleep(120);});await settle();}
async function start(width=140,height=44) {
  bible=new BibleStore(':memory:');torah=new TorahStore(':memory:');
  t=await testRender(<App store={bible} torahStore={torah} initialLibrary="torah"/>,{width,height});await settle();
}
const frame=()=>t!.captureCharFrame();
async function click(label:string) {const lines=frame().split('\n');const y=lines.findIndex(line=>line.includes(label));expect(y).toBeGreaterThanOrEqual(0);await act(async()=>{await t!.mockMouse.click(lines[y].indexOf(label)+1,y);});await settle();}
async function search(text:string) {if(frame().includes('Books [o]'))await click('Read');await key('/');await act(async()=>{t!.mockInput.typeText(text);});await settle();await key('RETURN');}

describe('Local Torah corpus',()=>{
 test('both pinned public-domain editions are complete and aligned without changing Bible numbering',async()=>{
  torah=new TorahStore(':memory:');
  expect(torah.books).toHaveLength(5);expect(torah.metadata.versesPerEdition).toBe(5846);
  expect(torah.editions.every(v=>v.license==='Public Domain')).toBe(true);
  expect(torah.db.query('PRAGMA integrity_check').get()).toEqual({integrity_check:'ok'});
  for(const book of torah.books)for(let chapter=1;chapter<=book.chapters;chapter++){
   const he=torah.chapter(book.id,chapter,'hebrew'),en=torah.chapter(book.id,chapter,'jps1917');
   expect(he.map(v=>v.verse)).toEqual(en.map(v=>v.verse));expect(he.every(v=>v.text.trim())).toBe(true);
  }
  const raw=await Bun.file('data/torah-source/Genesis-he.json').json();
  expect(torah.verse({book_id:1,chapter:1,verse:1},'hebrew')!.text).toBe(raw.text[0][0]);
  expect(torah.verse({book_id:1,chapter:1,verse:1},'jps1917')!.text).toBe('In the beginning God created the heaven and the earth.');
  const source=torah.metadata.entries.find(e=>e.book==='Genesis'&&e.language==='he')!;
  expect(new Bun.CryptoHasher('sha256').update(await Bun.file('data/torah-source/Genesis-he.json').arrayBuffer()).digest('hex')).toBe(source.sha256);
 });
 test('Hebrew search ignores points, English search stays in JPS, aliases and boundaries are explicit',()=>{
  torah=new TorahStore(':memory:');
  const bare=torah.search('בראשית'),pointed=torah.search('בְּרֵאשִׁית');
  expect(bare.verses.map(v=>v.id)).toEqual(pointed.verses.map(v=>v.id));expect(bare.verses[0].verse).toBe(1);expect(bare.edition).toBe('hebrew');
  expect(torah.search('covenant').verses.every(v=>v.edition==='jps1917'&&v.book_id<=5)).toBe(true);
  expect(normalizeTorahSearch('אֶת־הָאָרֶץ')).toBe('את הארץ');
  expect(torah.parseReference('Shemot 3:14')).toEqual({book_id:2,chapter:3,verse:14});
  expect(torah.parseReference('בְּרֵאשִׁית 1:1')).toEqual({book_id:1,chapter:1,verse:1});
  expect(()=>torah!.parseReference('John 3:16')).toThrow('outside');
  expect(()=>torah!.parseReference('Genesis 99:1')).toThrow('not present');
  expect(torah.adjacent({book_id:1,chapter:50,verse:1},1)).toEqual({book_id:2,chapter:1,verse:1});
  expect(torah.adjacent({book_id:5,chapter:34,verse:1},1)).toBeNull();
 });
 test('Torah bookmarks are independent of the existing Bible bookmarks',()=>{
  torah=new TorahStore(':memory:');const ref={book_id:1,chapter:1,verse:1};
  torah.notes.exec('CREATE TABLE bookmarks(book_id INTEGER,chapter INTEGER,verse INTEGER); INSERT INTO bookmarks VALUES(1,1,1)');
  expect(torah.isSaved(ref)).toBe(false);torah.toggleSaved(ref);expect(torah.saved()).toEqual([ref]);
  torah.toggleSaved(ref);expect(torah.saved()).toEqual([]);expect(torah.notes.query('SELECT count(*) n FROM bookmarks').get()).toEqual({n:1});
 });
});
describe('Hebrew terminal layout',()=>{
 test('bidi keeps digits, punctuation and vowel clusters intact while wrapping logical words',()=>{
  expect(visualHebrewLine('אבג 123')).toBe('123 גבא');
  expect(visualHebrewLine('אבג (123)')).toBe('(123) גבא');
  expect(visualHebrewLine('שָׁלוֹם')).toBe('םוֹלשָׁ');
  expect(withHebrewMarks('בְּרֵאשִׁ֖ית','plain')).toBe('בראשית');
  expect(withHebrewMarks('בְּרֵאשִׁ֖ית','vowels')).toBe('בְּרֵאשִׁית');
  const logical='בְּרֵאשִׁ֖ית בָּרָ֣א אֱלֹהִ֑ים אֵ֥ת הַשָּׁמַ֖יִם וְאֵ֥ת הָאָֽרֶץ׃';
  const wrapped=wrapLogical(logical,18);expect(wrapped.join(' ')).toBe(logical);
  const visual=hebrewDisplay(logical,18);expect(visual.split('\n')).toHaveLength(wrapped.length);
  expect(visual.split('\n').every(line=>stringWidth(line)===18)).toBe(true);
  expect(wrapLogical('בְּרֵאשִׁ֖ית',3).every(line=>stringWidth(line)<=3&&!/^\p{M}/u.test(line))).toBe(true);
 });
});
describe('Torah reading and navigation',()=>{
 test('parallel reading, language toggles, marks, chapter navigation and library switching retain state',async()=>{
  await start();expect(frame()).toContain('5 books');expect(frame()).toContain('Deuteronomy');
  await click('Read Genesis 1');expect(frame()).toContain('GENESIS  1');expect(frame()).toContain('In the beginning God created');
  expect(frame()).toContain(visualHebrewLine('בְּרֵאשִׁ֖ית'));
  await click('Hebrew');expect(frame()).not.toContain('In the beginning God created');
  await key('m');expect(frame()).toContain('Vowels');await click('English');expect(frame()).toContain('In the beginning God created');
  await key(']');expect(frame()).toContain('GENESIS  2');
  await click('Bible');expect(frame()).toContain('JOHN  1');
  await key(']');expect(frame()).toContain('JOHN  2');
  await click('Torah');expect(frame()).toContain('GENESIS  2');
  await click('Sources');expect(frame()).toContain('Public Domain');
  await click('? Help');expect(frame()).toContain('A FEW KEYS. A WHOLE LIBRARY.');
  await key('ESCAPE');expect(frame()).toContain('TORAH SOURCES');
  await key('ESCAPE');expect(frame()).toContain('GENESIS  2');
  await click('Bible');expect(frame()).toContain('JOHN  2');
 });
 test('references and Hebrew results open the matching Torah verse without Bible actions leaking',async()=>{
  await start(80,24);await search('Shemot 3:14');expect(frame()).toContain('EXODUS  3');expect(frame()).toContain('Exodus 3:14');
  await key('b');expect(frame()).toContain('Saved Exodus 3:14');await key('s');expect(frame()).toContain('SAVED PASSAGES');
  await key('RETURN');expect(frame()).toContain('EXODUS  3');
  await search('בראשית');expect(frame()).toContain('SEARCH RESULTS');expect(frame()).toContain('Genesis 1:1');
  await key('RETURN');expect(frame()).toContain('GENESIS  1');await key('x');expect(frame()).toContain('Books [o]');
  await search('John 3:16');expect(frame()).toContain('outside this Torah');expect(frame()).not.toContain('JOHN  3');
 });
 test('small terminals keep paired scripture, controls and back navigation visible',async()=>{
  await start(60,18);await key('h');await key('ARROW_RIGHT');await key('RETURN');
  expect(frame()).toContain('GENESIS  2');expect(frame()).toContain('And the heaven and the earth');
  expect(frame()).toContain('Hebrew');expect(frame()).toContain('Parallel');expect(frame()).toContain('y Copy');
  await click('English');expect(frame()).toContain('And the heaven and the earth');await key('BACKSPACE');expect(frame()).toContain('Read Genesis 2');
  await click('Bible');expect(frame()).toContain('Ask [i]');await click('Torah');expect(frame()).toContain('Read Genesis 2');
 });
});
