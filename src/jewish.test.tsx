import { afterEach, expect, test as corpusTest } from 'bun:test';
import { act } from 'react';
import { testRender } from '@opentui/react/test-utils';
import { App } from './app';
import { BibleStore } from './store';
import { JewishStore, jewishLibraries, type JewishLibraryId } from './jewish-store';
import { HybridSearch, type BibleSearch } from './search';
import { wholeBibleRequest } from './research';
import { instructionsFor, parseStudyAnswer, studyRequest, type StudyRequest } from './study';
import { missingData } from '../tests/helpers/data';
const test = corpusTest.skipIf(missingData(["bible", "bavli", "yerushalmi", "mishnah", "midrash", "zohar", "shulchan"]));
const opened:JewishStore[]=[];let bible:BibleStore|undefined,ui:Awaited<ReturnType<typeof testRender>>|undefined;
const open=(id:JewishLibraryId)=>{const s=new JewishStore(id,':memory:');opened.push(s);return s;};
const empty:BibleSearch={async search(query){return {query,hits:[],mode:'hybrid',elapsedMs:0,indexedPassages:1};}};
afterEach(async()=>{if(ui)await act(async()=>{await ui!.dispose();});ui=undefined;for(const s of opened.splice(0))s.close();bible?.close();bible=undefined;});
const frame=()=>ui!.captureCharFrame();
async function settle(){await act(async()=>{for(let i=0;i<4;i++){await ui!.renderOnce();await Bun.sleep(25);}});}
async function key(name:string){await act(async()=>{ui!.mockInput.pressKey(name);if(name==='ESCAPE')await Bun.sleep(120);});await settle();}
async function click(label:string){const rows=frame().split('\n'),y=rows.findIndex(r=>r.includes(label));expect(y).toBeGreaterThanOrEqual(0);await act(async()=>{await ui!.mockMouse.click(rows[y].indexOf(label)+1,y);});await settle();}

test('six installed corpora preserve canonical native references, boundaries, and isolated editions',()=>{
 const expected:Record<JewishLibraryId,[number,string]>={bavli:[37,'Berakhot 2a:1'],yerushalmi:[39,'Jerusalem Talmud Berakhot 1:1:1'],mishnah:[63,'Mishnah Berakhot 1:1'],midrash:[354,'Bereshit Rabbah 1:1'],zohar:[46,'Zohar, Introduction 1:1'],shulchan:[6,'Shulchan Arukh, Orach Chayim 1:1']};
 for(const id of Object.keys(jewishLibraries) as JewishLibraryId[]){
  const s=open(id),[count,reference]=expected[id];expect(s.books.length).toBe(count);expect(s.label(s.chapter(1,1,'english')[0])).toBe(reference);
  const range=s.resolveReference(reference,'english');expect(range.start).toEqual({book_id:1,chapter:1,verse:1});expect(s.rangeLabel(range)).toBe(reference);
  expect(s.sourcesFor(1).every(source=>source.license&&source.versionTitle)).toBe(true);
  expect(()=>s.resolveReference('John 3:16','english')).toThrow('outside');expect(()=>s.chapter(1,1,'WEB')).toThrow('Choose');
  expect(s.parseReference('39 categories of labor')).toBeNull();
  const all=s.db.query<{n:number},[]>('SELECT count(*) n FROM verses').get()!.n;expect(all).toBeGreaterThan(8000);
 }
 const bavli=opened[0],yeru=opened[1];expect(bavli.unitLabel(1,2)).toBe('2b');expect(yeru.unitLabel(1,2)).toBe('1:2');
 const range=bavli.resolveReference('Berakhot 2a:2-2b:2','english');expect(range.end).toEqual({book_id:1,chapter:2,verse:2});expect(bavli.resolveReference(bavli.rangeLabel(range),'english')).toEqual(range);
 expect(()=>bavli.resolveReference('Berakhot 2b:2-2a:1','english')).toThrow('reversed');
 expect(bavli.verse(1,1,1,'english')!.text).not.toBe(yeru.verse(1,1,1,'english')!.text);
});

test('missing translations remain gaps; keyword fallback and bookmarks open the actual available edition',async()=>{
 const zohar=open('zohar');expect(zohar.chapter(1,1,'original')[0].missing).toBeTruthy();expect(zohar.verse(1,1,1,'original')).toBeNull();
 const range=zohar.resolveReference('Zohar, Introduction 1:1','english');expect(zohar.passage(range,'original')).toMatchObject({total:0,omitted:true,verses:[]});
 const source=zohar.verse(1,1,1,'english')!;zohar.toggleSaved(source);expect(zohar.saved('original')[0].translation).toBe('english');expect(open('mishnah').saved('english')).toEqual([]);
 const search=new HybridSearch(zohar,'/tmp/unavailable-jewish-index.sqlite');try{const r=await search.search('light','original');expect(r.mode).toBe('keyword');expect(r.hits.length).toBeGreaterThan(0);expect(r.hits.every(h=>h.translation==='english')).toBe(true);}finally{search.close();}
 const yeru=open('yerushalmi');const note=yeru.db.query<any,[string]>('SELECT * FROM verses WHERE notes != ? LIMIT 1').get('');expect(note.notes.length).toBeGreaterThan(10);expect(note.raw_html).toContain('footnote');expect(note.text).not.toContain('<');
});

test('all library research tools validate native citations and named editions without crossing collections',async()=>{
 for(const id of Object.keys(jewishLibraries) as JewishLibraryId[]){
  const s=open(id),verse=s.db.query<any,[]>('SELECT * FROM verses WHERE translation="english" ORDER BY book_id,chapter,verse LIMIT 1').get(),ref=s.label(verse);const req=await wholeBibleRequest(s,empty,'Explain the opening passage.','english',new AbortController().signal,()=>{});
  expect(req.tools!.definitions.map(t=>t.name)).toEqual([id+'_search',id+'_read',id+'_connections']);
  const read=await req.tools!.call(id+'_read',{reference:ref}) as any;expect(read.sources.length).toBe(1);expect(read.sources[0].edition).toBeTruthy();expect(read.sources[0].text).toBe(verse.text);
  const answer=parseStudyAnswer(JSON.stringify({answer:'The text says this [S1].',citations:['S1'],insufficientEvidence:false}),req);expect(answer.sources[0].label).toBe(ref+' · English');
  expect(instructionsFor(req)).toContain(id+'_read');expect(instructionsFor(req)).not.toContain('66 books');expect(instructionsFor(req)).not.toContain('KJV');
  await expect(req.tools!.call(id+'_read',{reference:'Genesis 1:1'})).rejects.toThrow('outside');await expect(req.tools!.call(id+'_read',{reference:ref,translation:'WEB'})).rejects.toThrow('Translation');
  if(id==='zohar'){const missing=await req.tools!.call('zohar_read',{reference:ref,translation:'original'}) as any;expect(missing.omittedVerses).toBe(true);expect(missing.sources).toEqual([]);}
 }
});

test('library picker preserves reading positions; native unit picker, summaries and compact reader remain usable',async()=>{
 bible=new BibleStore(':memory:');const bavli=open('bavli'),mishnah=open('mishnah');
 ui=await testRender(<App store={bible} initialLibrary="bavli" jewishStores={{bavli,mishnah}} jewishSearch={empty}/>,{width:100,height:30});await settle();
 expect(frame()).toContain('Seder Zeraim');expect(frame()).not.toContain('NEW TESTAMENT');expect(frame()).toContain('Blessings and prayers');
 await key('RETURN');await key('h');expect(frame()).toContain('2a');expect(frame()).toContain('2b');await key('ARROW_RIGHT');await key('RETURN');expect(frame()).toContain('BERAKHOT  2b');
 await click('Bavli ▾');expect(frame()).toContain('CHOOSE A LIBRARY');await key('ARROW_DOWN');await key('ARROW_DOWN');await key('RETURN');expect(frame()).toContain('Mishnah ▾');
 await click('Mishnah ▾');await key('ARROW_UP');await key('ARROW_UP');await key('RETURN');expect(frame()).toContain('BERAKHOT  2b');
 await click('Bible');expect(frame()).toContain('JOHN  1');
});

test('topic results in an available edition lead to reading and verified Ask citations',async()=>{
 bible=new BibleStore(':memory:');const zohar=open('zohar'),asked:StudyRequest[]=[];
 const search:BibleSearch={async search(query){const verse=zohar.verse(1,1,1,'english')!,range={start:verse,end:verse};return {query,mode:'hybrid',elapsedMs:0,indexedPassages:1,hits:[{id:verse.id,label:zohar.label(verse),translation:'english',text:verse.text,range,score:1,channels:['semantic']}]};}};
 ui=await testRender(<App store={bible} initialLibrary="zohar" jewishStores={{zohar}} jewishSearch={search} assistant={async req=>{asked.push(req);await req.tools!.call('zohar_read',{reference:'Zohar, Introduction 1:1'});return {answer:'This passage describes the rose [S1].',sources:[req.sources[0]],model:'test',plan:'test'};}}/>,{width:60,height:18});await settle();
 expect(frame()).toContain('Zohar ▾');await key('v');await key('u');await key('/');await act(async()=>{ui!.mockInput.typeText('light');});await key('RETURN');expect(frame()).toContain('Zohar, Introduction 1:1');
 await key('g');expect(frame()).toContain('English');expect(frame()).not.toContain('This passage is absent');await key('u');
 await key('RETURN');expect(frame()).toContain('INTRODUCTION  1');expect(frame()).toContain('English');await key('BACKSPACE');await key('i');await settle();expect(asked[0].collection).toBe('zohar');expect(frame()).toContain('Whole Zohar');
});
