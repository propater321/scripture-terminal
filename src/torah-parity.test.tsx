import { afterEach, expect, test as corpusTest } from 'bun:test';
import { act } from 'react';
import { testRender } from '@opentui/react/test-utils';
import { App } from './app';
import { BibleStore } from './store';
import { TorahStore } from './torah-store';
import { TorahAdapter } from './torah-adapter';
import { HybridSearch, type BibleSearch } from './search';
import { wholeBibleRequest } from './research';
import { instructionsFor, studyRequest, parseStudyAnswer, type StudyRequest } from './study';
import { missingData } from '../tests/helpers/data';
const test = corpusTest.skipIf(missingData(["bible", "torah", "torah-links"]));
let torah: TorahStore, store: TorahAdapter, bible: BibleStore;
let ui: Awaited<ReturnType<typeof testRender>> | undefined;
afterEach(async () => { if(ui) await act(async()=>{await ui!.dispose();}); ui=undefined;store?.close();torah?.close();bible?.close(); });
function init(){torah=new TorahStore(':memory:');store=new TorahAdapter(torah);}
const empty: BibleSearch={async search(query){return {query,hits:[],mode:'hybrid',elapsedMs:0,indexedPassages:3900};}};
const frame=()=>ui!.captureCharFrame();
async function settle(){await act(async()=>{for(let pass=0;pass<3;pass++){await ui!.renderOnce();await Bun.sleep(25);}});}
async function key(name:string){await act(async()=>{ui!.mockInput.pressKey(name);if(name==='ESCAPE')await Bun.sleep(110);});await settle();}
async function click(label:string){const rows=frame().split('\n'),y=rows.findIndex(row=>row.includes(label));expect(y).toBeGreaterThanOrEqual(0);await act(async()=>{await ui!.mockMouse.click(rows[y].indexOf(label)+1,y);});await settle();}

test('Torah research tools, editions, instructions and citation ledger remain scoped to Torah',async()=>{
 init();const request=await wholeBibleRequest(store,empty,'How should strangers be treated?','jps1917',new AbortController().signal,()=>{});
 expect(request.collection).toBe('torah');expect(request.passage).toBe('Whole Torah · JPS 1917');
 expect(request.tools!.definitions.map(t=>t.name)).toEqual(['torah_search','torah_read','torah_connections']);
 const read=await request.tools!.call('torah_read',{reference:'Leviticus 19:33-34'}) as any;
 expect(read.sources).toHaveLength(2);expect(read.sources[1].text).toBe(store.verse(3,19,34,'jps1917')!.text);
 const he=await request.tools!.call('torah_read',{reference:'ויקרא 19:34',translation:'hebrew'}) as any;
 expect(he.sources[0].text).toBe(store.verse(3,19,34,'hebrew')!.text);
 const answer=parseStudyAnswer(JSON.stringify({answer:'Love the stranger [S2].',citations:['S2'],insufficientEvidence:false}),request);
 expect(answer.sources[0].verse.translation).toBe('jps1917');expect(answer.sources[0].verse.book_id).toBe(3);
 await expect(request.tools!.call('torah_read',{reference:'John 3:16'})).rejects.toThrow('outside');
 await expect(request.tools!.call('torah_read',{reference:'Genesis 1',translation:'WEB'})).rejects.toThrow('Translation');
 await expect(request.tools!.call('torah_search',{query:'love',book_id:43})).rejects.toThrow('Book ID');
 await expect(request.tools!.call('bible_read',{reference:'Genesis 1'})).rejects.toThrow('Unknown Torah tool');
 const instructions=instructionsFor(request);expect(instructions).toContain('torah_read');expect(instructions).toContain('Sefaria verse numbering');expect(instructions).not.toContain('66 books');expect(instructions).not.toContain('KJV');
 const passage=studyRequest(store,store.verse(2,3,14,'hebrew')!,'Compare the wording.');
 expect(passage.collection).toBe('torah');expect(new Set(passage.sources.map(s=>s.verse.translation))).toEqual(new Set(['hebrew','jps1917']));
});

test('Torah connections resolve only valid native Torah addresses; keyword fallback supports unpointed Hebrew',async()=>{
 init();expect(store.linksMetadata!.rows).toBeGreaterThan(1000);
 const rows=store.links!.query<{source_key:number;target_start:number;target_end:number},[]>('SELECT * FROM links').all();
 for(const row of rows)for(const address of [row.source_key,row.target_start,row.target_end]){
   const b=Math.floor(address/1000000),c=Math.floor(address%1000000/1000),v=address%1000;
   expect(b>=1&&b<=5&&!!store.verse(b,c,v,'hebrew')).toBe(true);
 }
 const links=store.crossReferences({start:{book_id:1,chapter:1,verse:1},end:{book_id:1,chapter:1,verse:1}});
 expect(links.total).toBeGreaterThan(0);
 const search=new HybridSearch(store,'/tmp/nonexistent-torah-semantic.sqlite');
 try{const bare=await search.search('בראשית','hebrew'),marked=await search.search('בְּרֵאשִׁית','hebrew');expect(bare.mode).toBe('keyword');expect(bare.hits.length).toBeGreaterThan(0);expect(bare.hits.map(h=>h.id)).toEqual(marked.hits.map(h=>h.id));await expect(search.search('covenant','WEB')).rejects.toThrow('Unknown translation');}finally{search.close();}
});

test('Torah Explore topics, Ask, citation navigation, connections, Atlas and comparison share the workspace',async()=>{
 init();bible=new BibleStore(':memory:');const asked:StudyRequest[]=[];let searches=0;
 const search:BibleSearch={async search(query,translation){searches++;const start={book_id:3,chapter:19,verse:33},end={...start,verse:34};return {query,mode:'hybrid',elapsedMs:0,indexedPassages:3900,hits:[{id:1,label:'Leviticus 19:33–34',range:{start,end},translation,text:store.passage({start,end},translation).verses.map(v=>v.text).join(' '),score:1,channels:['keyword','semantic']}]};}};
 ui=await testRender(<App store={bible} torahStore={torah} initialLibrary="torah" torahSearch={search} assistant={async request=>{asked.push(request);await request.tools!.call('torah_read',{reference:'Leviticus 19:34',translation:'hebrew'});return {answer:'Care for the stranger [S3].',sources:[request.sources.at(-1)!],model:'test',plan:'test'};}}/>,{width:140,height:44});await settle();
 expect(frame()).toContain('EXPLORE THE TORAH');expect(frame()).not.toContain('NEW TESTAMENT');
 await key('u');await key('/');await act(async()=>{ui!.mockInput.typeText('care for strangers');});await key('RETURN');expect(searches).toBe(1);expect(frame()).toContain('Leviticus 19:33');
 await key('i');await settle();expect(asked).toHaveLength(1);expect(asked[0].collection).toBe('torah');expect(frame()).toContain('Whole Torah');expect(frame()).toContain('Care for the stranger');
 await click('Leviticus 19:34 · Hebrew');expect(frame()).toContain('LEVITICUS  19');await key('ESCAPE');
 await click('Read');await click('English');await key('x');await click('Connections [g]');expect(frame()).toContain('Sefaria');expect(frame()).toContain('● Leviticus 19:34');
 await key('ESCAPE');await key('a');expect(frame()).toContain('ATLAS');expect(frame()).not.toContain('NT');
 expect(frame()).toContain('PARALLEL TEXT');await key('c');expect(frame()).not.toContain('PARALLEL TEXT');await key('c');expect(frame()).toContain('PARALLEL TEXT');
 await click('Bible');expect(frame()).toContain('JOHN  1');await click('Torah');expect(frame()).toContain('LEVITICUS  19');
});
