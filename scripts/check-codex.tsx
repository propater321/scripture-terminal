// Opt-in integration check: this sends ONE real request using the signed-in Codex subscription.
import { strict as assert } from 'node:assert';
import { act } from 'react';
import { testRender } from '@opentui/react/test-utils';
import { App } from '../src/app';
import { askCodex } from '../src/codex';
import { BibleStore } from '../src/store';
import type { StudyAnswer } from '../src/study';

const store = new BibleStore(':memory:');
let answer: StudyAnswer | undefined;
let failure: unknown;
const t = await testRender(<App store={store} assistant={async (request, signal, progress) => {
  try {
    answer = await askCodex(request, signal, update => { console.log(update.status); progress(update); });
    return answer;
  } catch (error) { failure = error; throw error; }
}} />, { width: 140, height: 44 });

async function key(name: string) {
  await act(async () => { t.mockInput.pressKey(name); await Bun.sleep(50); }); await t.renderOnce();
}
async function type(text: string) {
  await act(async () => { await t.mockInput.typeText(text); });
}
async function capture(name: string) {
  await t.renderOnce();
  await Bun.write(new URL(`../previews/${name}.json`, import.meta.url), JSON.stringify(t.captureSpans()));
  await Bun.write(new URL(`../previews/${name}.txt`, import.meta.url), t.captureCharFrame());
}
try {
  await key('/'); await type('John 1:5'); await key('RETURN');
  await key('i'); await key('ESCAPE'); await Bun.sleep(100); await key('p'); await key('e');
  await type('Explain the contrast between light and darkness in this verse in two sentences.');
  await key('RETURN');
  const deadline = Date.now() + 150_000;
  while (!answer && !failure && Date.now() < deadline) await act(async () => { await Bun.sleep(100); });
  if (failure) throw failure;
  assert.ok(answer, 'Codex did not complete the request');
  await act(async () => { await Bun.sleep(100); });
  await capture('workspace-ask');
  assert.match(t.captureCharFrame(), /VERSE SOURCES/);
  assert.ok(answer.sources.length > 0);
  console.log(JSON.stringify({ model: answer.model, answer: answer.answer, sources: answer.sources.map(source => source.label) }));
  await act(async () => { t.resize(80, 24); await Bun.sleep(80); });
  await capture('workspace-ask-compact');
  assert.match(t.captureCharFrame(), /ASK SCRIPTURE/);
  await key('\x1b[6~');
  await capture('workspace-ask-compact-scrolled');
  assert.match(t.captureCharFrame(), /VERSE SOURCES/);
  await key('ESCAPE');
  assert.match(t.captureCharFrame(), /JOHN  1/);
  console.log('Live subscription inference, source validation, terminal rendering, compact scrolling, and return to reading passed.');
} finally {
  await act(async () => { await t.dispose(); }); store.close();
}
