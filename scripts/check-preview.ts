import { Terminal } from '@xterm/headless';
import { strict as assert } from 'node:assert';
const origin = `http://127.0.0.1:${process.env.BIBLE_PREVIEW_PORT || 4317}`;
const response = await fetch(origin);
assert.equal(response.status, 200);
assert.equal(response.headers.get('x-frame-options'),'DENY');
assert.match(await response.text(), /Read\. Compare\. See the whole story/);
for (const file of ['/xterm.js', '/fit.js', '/xterm.css']) assert.equal((await fetch(origin + file)).status, 200);
assert.equal((await fetch(origin + '/terminal', { headers: { Origin: 'https://example.com' } })).status, 403);

for (const mode of ['workspace', 'study', 'reader', 'atlas']) {
  const terminal = new Terminal({ cols: 140, rows: 44, allowProposedApi: true });
  const ws = new WebSocket(`${origin.replace('http:', 'ws:')}/terminal?mode=${mode}&cols=140&rows=44`, { headers: { Origin: origin } });
  ws.binaryType = 'arraybuffer';
  ws.onmessage = event => terminal.write(new Uint8Array(event.data as ArrayBuffer));
  terminal.onData(data => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'input', data })); });
  const screen = () => Array.from({ length: terminal.rows }, (_, y) => terminal.buffer.active.getLine(y)?.translateToString(false, 0, terminal.cols) ?? '').join('\n');
  const waitFor = async (value: string) => {
    const deadline = Date.now() + 6000;
    while (!screen().includes(value) && Date.now() < deadline) await Bun.sleep(30);
    assert.ok(screen().includes(value), `Missing ${value} in ${mode}:\n${screen()}`);
  };
  const waitForHidden = async (value: string) => {
    const deadline = Date.now() + 6000;
    while (screen().includes(value) && Date.now() < deadline) await Bun.sleep(30);
    assert.ok(!screen().includes(value), `Still showing ${value} in ${mode}:\n${screen()}`);
  };
  try {
    await waitFor('S C R I P T U R E');
    await waitFor(mode === 'study' || mode === 'workspace' ? 'PARALLEL TEXT' : mode === 'reader' ? 'PSALMS' : 'THE CANON');
    ws.send(JSON.stringify({ type: 'input', data: '/' }));
    await Bun.sleep(70);
    ws.send(JSON.stringify({ type: 'input', data: 'John 3:16' }));
    await Bun.sleep(70);
    ws.send(JSON.stringify({ type: 'input', data: '\r' }));
    // Wait for submission to finish; the reference also appears in the input
    // before the app has committed the jump and released keyboard focus.
    await waitFor('Jump to a passage or search a word / phrase');
    await waitFor('John 3:16');
    if (mode === 'atlas') { ws.send(JSON.stringify({ type: 'input', data: '\r' })); await waitFor('/ READER'); }
    await waitFor('only born Son');
    if (mode === 'workspace') {
      ws.send(JSON.stringify({ type: 'input', data: '\x1bOR' }));
      await waitFor('ATLAS  /');
      await waitFor('John 3:16');
      ws.send(JSON.stringify({ type: 'input', data: 'i' }));
      await waitFor('ASK SCRIPTURE');
      await waitFor('Your Codex subscription');
      assert.ok(!screen().includes('PARALLEL TEXT'));
      ws.send(JSON.stringify({ type: 'input', data: '\x1b' }));
      await Bun.sleep(90);
      ws.send(JSON.stringify({ type: 'input', data: 'c' }));
      await waitFor('PARALLEL TEXT');
      await waitFor('John 3:16');
      ws.send(JSON.stringify({ type: 'input', data: '\x1bOQ' }));
      await waitForHidden('PARALLEL TEXT');
      await waitFor('only born Son');
      assert.ok(!screen().includes('ATLAS  /'));
      ws.send(JSON.stringify({ type: 'input', data: 'f' }));
      await waitFor('ATLAS  /');
      await waitFor('John 3:16');
    }
    console.log(`${mode}: live PTY, search input, reference jump and reading passed`);
  } finally { ws.close(); terminal.dispose(); }
}
