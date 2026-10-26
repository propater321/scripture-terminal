import { act } from 'react';
import { testRender } from '@opentui/react/test-utils';
import { App, type Mode } from '../src/app';
import { BibleStore } from '../src/store';
const store = new BibleStore(':memory:');
for (const mode of ['workspace', 'study', 'reader', 'atlas'] as Mode[]) {
  const t = await testRender(<App store={store} initialMode={mode} />, { width: 140, height: 44 });
  await t.renderOnce();
  await t.flush();
  await Bun.write(new URL(`../previews/${mode}.txt`, import.meta.url), t.captureCharFrame());
  await Bun.write(new URL(`../previews/${mode}.json`, import.meta.url), JSON.stringify(t.captureSpans()));
  console.log(mode + '\n' + t.captureCharFrame());
  if (mode === 'workspace') {
    for (const [key, name] of [['a', 'workspace-atlas'], ['f', 'workspace-focus']]) {
      await act(async () => { t.mockInput.pressKey(key); await new Promise(r => setTimeout(r, 60)); });
      await t.renderOnce();
      await Bun.write(new URL(`../previews/${name}.txt`, import.meta.url), t.captureCharFrame());
      await Bun.write(new URL(`../previews/${name}.json`, import.meta.url), JSON.stringify(t.captureSpans()));
    }
  }
  await act(async () => { await t.dispose(); });
}
store.close();
