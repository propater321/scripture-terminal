import { act } from 'react';
import { testRender } from '@opentui/react/test-utils';
import { App } from '../src/app';
import { BibleStore } from '../src/store';

const store = new BibleStore(':memory:');
for (const [width, height, name] of [[140, 44, 'explore'], [100, 30, 'explore-medium'], [80, 24, 'explore-compact'], [60, 18, 'explore-small']] as const) {
  const t = await testRender(<App store={store} initialExplore />, { width, height });
  async function key(value: string) { await act(async () => { t.mockInput.pressKey(value); await Bun.sleep(60); await t.renderOnce(); }); }
  async function save(file: string) {
    await act(async () => { await t.renderOnce(); });
    await Bun.write(new URL(`../previews/${file}.txt`, import.meta.url), t.captureCharFrame());
    await Bun.write(new URL(`../previews/${file}.json`, import.meta.url), JSON.stringify(t.captureSpans()));
  }
  await key('g'); await key('/');
  await act(async () => { await t.mockInput.typeText('John 1:5'); });
  await key('RETURN'); await key('ARROW_DOWN');
  await save(name);
  if (width === 140) { await key('a'); await save('explore-atlas'); }
  await act(async () => { await t.dispose(); });
  console.log(`Captured ${name} at ${width}×${height}`);
}
store.close();
