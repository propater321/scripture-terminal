// Capture the actual UI with public example passages and temporary bookmarks.
// No saved answers, account details, or model requests are used.
import { mkdir, copyFile } from 'node:fs/promises';
import { act } from 'react';
import { testRender } from '@opentui/react/test-utils';
import { App } from '../src/app';
import { BibleStore } from '../src/store';
import { TorahStore } from '../src/torah-store';

const bible = new BibleStore(':memory:'), torah = new TorahStore(':memory:');
const names = ['public-read', 'public-explore', 'public-torah', 'public-ask'];
await mkdir('previews', { recursive: true });
try {
  for (const name of names) {
    const t = await testRender(<App store={bible} torahStore={torah}
      initialLibrary={name === 'public-torah' ? 'torah' : 'bible'}
      initialExplore={name === 'public-explore'}
      assistant={async () => { throw new Error('Public captures never submit model requests.'); }}
    />, { width: 140, height: 44 });
    const key = async (value: string) => act(async () => {
      t.mockInput.pressKey(value); await Bun.sleep(100); await t.renderOnce();
    });
    try {
      await key('');
      if (name === 'public-read') await key('a');
      if (name === 'public-torah') { await key('RETURN'); await key('RETURN'); }
      if (name === 'public-ask') await key('i');
      for (let n = 0; n < 3; n++) await act(async () => { await t.renderOnce(); await Bun.sleep(40); });
      await Bun.write(`previews/${name}.json`, JSON.stringify(t.captureSpans()));
      await Bun.write(`previews/${name}.txt`, t.captureCharFrame());
    } finally { await act(async () => { await t.dispose(); }); }
  }
} finally { torah.close(); bible.close(); }
const python = process.env.SCRIPTURE_CAPTURE_PYTHON || '.venv-search/bin/python';
const status = await Bun.spawn([python, 'scripts/render-previews.py', ...names], { stdout: 'inherit', stderr: 'inherit' }).exited;
if (status) process.exit(status);
await mkdir('docs/images', { recursive: true });
for (const name of names) await copyFile(`previews/${name}.png`, `docs/images/${name.slice(7)}.png`);
console.log('Captured four public documentation images from the terminal renderer.');
