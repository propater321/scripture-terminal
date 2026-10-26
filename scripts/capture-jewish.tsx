import { act } from 'react';
import { testRender } from '@opentui/react/test-utils';
import { App } from '../src/app';
import { BibleStore } from '../src/store';
import { JewishStore, jewishLibraries, type JewishLibraryId } from '../src/jewish-store';
const bible=new BibleStore(':memory:');
try{
 for(const library of (process.argv[2] ? [process.argv[2]] : Object.keys(jewishLibraries)) as JewishLibraryId[]){
  const store=new JewishStore(library,':memory:');
  try{for(const [width,height] of [[140,44],[60,18]]){
   const t=await testRender(<App store={bible} initialLibrary={library} jewishStores={{[library]:store}}/>,{width,height});
   async function settle(){await act(async()=>{for(let i=0;i<4;i++){await t.renderOnce();await Bun.sleep(30);}});}
   async function key(value:string){await act(async()=>{t.mockInput.pressKey(value);if(value==='ESCAPE')await Bun.sleep(120);});await settle();}
   async function save(name:string){await settle();await Bun.write(`previews/${library}-${width}-${name}.json`,JSON.stringify(t.captureSpans()));await Bun.write(`previews/${library}-${width}-${name}.txt`,t.captureCharFrame());}
   try{await save('explore');await key('RETURN');await key('RETURN');await save('read');await key('i');await save('ask');await key('ESCAPE');await key('ESCAPE');await key('F5');await save('libraries');console.log(library,width,'captured');}finally{await act(async()=>{await t.dispose();});}
  }}finally{store.close();}
 }
}finally{bible.close();}
