import { act } from 'react';
import { testRender } from '@opentui/react/test-utils';
import { App } from '../src/app';
import { BibleStore } from '../src/store';
import { TorahStore } from '../src/torah-store';
const bible = new BibleStore(':memory:'), torah = new TorahStore(':memory:');
try {
  for (const [width,height,name] of [[140,44,'torah'],[100,30,'torah-medium'],[80,24,'torah-compact'],[60,18,'torah-small']] as const) {
    const t = await testRender(<App store={bible} torahStore={torah} initialLibrary="torah" />, { width,height });
    async function key(value:string) { await act(async()=>{t.mockInput.pressKey(value);await Bun.sleep(value==='ESCAPE'?130:90);await t.renderOnce();}); }
    async function click(label:string) {const rows=t.captureCharFrame().split('\n'),y=rows.findIndex(r=>r.includes(label));if(y<0)throw new Error('Missing '+label);await act(async()=>{await t.mockMouse.click(rows[y].indexOf(label)+1,y);await Bun.sleep(80);await t.renderOnce();});}
    async function save(suffix:string) { for(let pass=0;pass<4;pass++)await act(async()=>{await t.renderOnce();await Bun.sleep(30);});await Bun.write(`previews/${name}-${suffix}.json`,JSON.stringify(t.captureSpans()));await Bun.write(`previews/${name}-${suffix}.txt`,t.captureCharFrame()); }
    try {
      await key('');await save('books');
      await key('RETURN');await key('RETURN');await save('parallel');
      await click('English');await save('english');
      await click('Hebrew');await save('hebrew');
      await key('m');await save('vowels');
      await click('Parallel');await key('/');await act(async()=>{t.mockInput.typeText('Shemot 3:14');});await key('RETURN');await save('reference');
      await key('/');await act(async()=>{t.mockInput.typeText('בראשית');});await key('RETURN');await save('search');
      await key('i');await save('ask');await key('ESCAPE');await key('ESCAPE');await key('x');await key('g');await save('connections');
      console.log(`Captured ${name}`);
    } finally {await act(async()=>{await t.dispose();});}
  }
} finally {torah.close();bible.close();}
