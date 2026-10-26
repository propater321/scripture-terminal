import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Terminal } from '@xterm/headless';
import { strict as assert } from 'node:assert';

// Drive the real CLI through a native PTY. No browser or model requests.
const terminal = new Terminal({ cols: 140, rows: 44, allowProposedApi: true });
const child = Bun.spawn(['bash', 'bin/scripture', 'explore'], {
  cwd: new URL('..', import.meta.url).pathname,
  env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
  terminal: { cols: 140, rows: 44, data(_pty, bytes) { terminal.write(bytes); } },
});
terminal.onData(data => child.terminal!.write(data));
const screen = () => Array.from({ length: terminal.rows }, (_, y) => terminal.buffer.active.getLine(y)?.translateToString(false, 0, terminal.cols) ?? '').join('\n');
async function waitFor(value: string) {
  const deadline = Date.now() + 6000;
  while (!screen().includes(value) && Date.now() < deadline) await Bun.sleep(30);
  assert.ok(screen().includes(value), `Missing ${value}:\n${screen()}`);
}
async function send(value: string) { child.terminal!.write(value); await Bun.sleep(120); }
try {
  await waitFor('THE WHOLE LIBRARY');
  await send('g'); await waitFor('● John 1:1');
  await send('/'); await send('John 1:5'); await send('\r');
  await waitFor('● John 1:5');
  const lines = screen().split('\n');
  const y = lines.findIndex(line => line.includes('├─ John 3:19–20'));
  assert.ok(y >= 0);
  const x = lines[y].indexOf('John 3:19–20');
  await send(`\x1b[<35;${x + 1};${y + 1}M`);
  await waitFor('PREVIEW · John 3:19–20');
  assert.ok(screen().includes('● John 1:5'));
  await send(`\x1b[<0;${x + 1};${y + 1}M\x1b[<0;${x + 1};${y + 1}m`);
  await waitFor('● John 3:19–20'); await waitFor('JOHN  3');
  await send('\x7f'); await waitFor('● John 1:5');
  await send('a'); await waitFor('ATLAS  /');
  await send('a');
  for (const [cols, rows] of [[80, 24], [60, 18]]) {
    terminal.resize(cols, rows); child.terminal!.resize(cols, rows);
    await Bun.sleep(200);
    await waitFor('● John 1:5'); await waitFor('PREVIEW');
    assert.ok(screen().includes('light'));
  }
  await send('\x1b'); await waitFor('JOHN  1');
  await send('x'); await send('u'); await send('/'); await send('anxiety and peace'); await send('\r');
  const root=new URL('..',import.meta.url).pathname;
  const meaning=existsSync(join(root,'data/semantic.sqlite')) && existsSync(join(root,'.venv-search/bin/python'));
  await waitFor(meaning ? 'keywords + meaning' : 'Keyword results only.');
  assert.match(screen(), /[A-Za-z]+ [0-9]+:[0-9]+/, screen());
  await send('o'); await waitFor('66 books');
  await send('\r'); await waitFor('GENESIS');
  await send('\r'); await waitFor('GENESIS  1');
  await waitFor('In the beginning, God created');
  await send('\x7f'); await waitFor('Read Genesis 1');
  await send('h'); await waitFor('Summary');
  await send('\x1b[C'); await send('\r'); await waitFor('GENESIS  2');
  await send('\x7f'); await waitFor('Read Genesis 2');
  await send('q');
  assert.equal(await Promise.race([child.exited, Bun.sleep(2000).then(() => 'timeout')]), 0);
  console.log('Explore: CLI launch, real mouse hover/click, backtracking, Atlas, resize, local topic search, book map, reading and clean exit passed.');
} finally {
  if (child.exitCode === null) child.kill();
  child.terminal?.close(); terminal.dispose();
}
