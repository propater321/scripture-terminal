// Render real local search and replay the saved, verified Codex answer; no new model request.
import { act } from 'react';
import { testRender } from '@opentui/react/test-utils';
import { App } from '../src/app';
import { BibleStore } from '../src/store';
import { HybridSearch } from '../src/search';
const store=new BibleStore(':memory:'), search=new HybridSearch(store);
const recorded=await Bun.file(new URL('../previews/research-answer.json',import.meta.url)).json();
for(const [width,height,name] of [[140,44,'topics'],[80,24,'topics-compact'],[60,18,'topics-small']] as const) {
 const t=await testRender(<App store={store} search={search} initialExplore assistant={async()=>recorded.answer}/>,{width,height});
 async function key(value:string){await act(async()=>{t.mockInput.pressKey(value);await Bun.sleep(value==='ESCAPE'?120:60);await t.renderOnce();});}
 async function waitFor(value:string){const until=Date.now()+15000;let frame='';while(Date.now()<until){await act(async()=>{await Bun.sleep(100);await t.renderOnce();});try{frame=t.captureCharFrame();}catch(error){if((error as Error).message.includes('OutputBusy'))continue;throw error;}if(frame.includes(value))return;}throw Error(`Missing ${value}:\n${frame}`);}
 async function save(file:string){await act(async()=>{await t.renderOnce();});await Bun.write(new URL(`../previews/${file}.json`,import.meta.url),JSON.stringify(t.captureSpans()));await Bun.write(new URL(`../previews/${file}.txt`,import.meta.url),t.captureCharFrame());}
 try{
  await key('u');await key('/');await act(async()=>{await t.mockInput.typeText(recorded.question);});await key('RETURN');await waitFor('keywords + meaning');await save(name);
  await key('z');await waitFor('· refined');await save(name+'-refined');
  await key('i');await waitFor('ASK SCRIPTURE');await waitFor('The Bible presents peace');await save(name+'-answer');
  console.log(`Captured ${name}, refinement and recorded live answer`);
 }finally{await act(async()=>{await t.dispose();});}
}
search.close();store.close();
