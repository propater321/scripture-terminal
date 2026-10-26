import { act } from 'react';
import { testRender } from '@opentui/react/test-utils';
import { App } from '../src/app';
import { BibleStore } from '../src/store';
const store = new BibleStore(':memory:');
for (const [width, height, name] of [[140,44,'library'],[100,30,'library-medium'],[80,24,'library-compact'],[60,18,'library-small']] as const) {
 const t=await testRender(<App store={store} initialExplore />, {width,height});
 async function key(value:string) { await act(async()=>{t.mockInput.pressKey(value);await Bun.sleep(80);await t.renderOnce();}); }
 async function save(name:string) { await act(async()=>{await t.renderOnce();}); await Bun.write(new URL(`../previews/${name}.json`,import.meta.url),JSON.stringify(t.captureSpans()));await Bun.write(new URL(`../previews/${name}.txt`,import.meta.url),t.captureCharFrame()); }
 await key(''); await save(name);
 await key('RETURN'); await save(name+'-book');
 await key('h'); await save(name+'-chapters');
 await key('ARROW_RIGHT'); await key('RETURN'); await save(name+'-reader');
 await key('BACKSPACE'); await key('ESCAPE'); await key('BACKSPACE');
 await key('/'); await act(async()=>{await t.mockInput.typeText('John');await t.renderOnce();}); await save(name+'-find');
 await key('ESCAPE');
 await key('u'); await save(name+'-topics');
 await act(async()=>{await t.dispose();});
 console.log(`Captured ${name}`);
}
store.close();
