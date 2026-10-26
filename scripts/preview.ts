import { join } from 'node:path';
const root = join(import.meta.dir, '..');
const port = Number(process.env.BIBLE_PREVIEW_PORT || 4317);
const allowedOrigins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
type Session = { mode: string; cols: number; rows: number; child?: ReturnType<typeof Bun.spawn> };
const children = new Set<ReturnType<typeof Bun.spawn>>();
const staticFiles: Record<string, string> = {
  '/': 'previews/index.html',
  '/xterm.js': 'node_modules/@xterm/xterm/lib/xterm.js',
  '/xterm.css': 'node_modules/@xterm/xterm/css/xterm.css',
  '/fit.js': 'node_modules/@xterm/addon-fit/lib/addon-fit.js',
};
const clamp = (n: number, min: number, max: number) => Number.isFinite(n) ? Math.max(min, Math.min(max, Math.floor(n))) : min;
const server = Bun.serve<Session>({
  hostname: '127.0.0.1', port,
  fetch(request, server) {
    const url = new URL(request.url);
    if (!allowedOrigins.has(url.origin)) return new Response('Local preview only', { status: 403 });
    if (url.pathname === '/terminal') {
      if (!allowedOrigins.has(request.headers.get('origin') ?? '')) return new Response('Invalid origin', { status: 403 });
      const mode = url.searchParams.get('mode') ?? 'workspace';
      if (!['workspace', 'study', 'reader', 'atlas'].includes(mode)) return new Response('Unknown layout', { status: 400 });
      if (children.size >= 8) return new Response('Close an unused preview tab first.', { status: 429 });
      if (server.upgrade(request, { data: { mode, cols: clamp(Number(url.searchParams.get('cols') || 140), 40, 250), rows: clamp(Number(url.searchParams.get('rows') || 44), 12, 100) } })) return;
      return new Response('Upgrade failed', { status: 400 });
    }
    const path = staticFiles[url.pathname];
    return path ? new Response(Bun.file(join(root, path)), { headers: { 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff' } }) : new Response('Not found', { status: 404 });
  },
  websocket: {
    maxPayloadLength: 32768,
    open(ws) {
      const child = Bun.spawn([process.execPath, 'src/main.tsx', ws.data.mode], {
        cwd: root, env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
        terminal: { cols: ws.data.cols, rows: ws.data.rows, data(_terminal, bytes) { if (ws.readyState === 1) ws.send(bytes); } },
        onExit(proc, code) { children.delete(proc); if (ws.readyState === 1) ws.close(1000, `Terminal exited (${code})`); },
      });
      children.add(child); ws.data.child = child;
    },
    message(ws, message) {
      try {
        const event = JSON.parse(String(message));
        if (event.type === 'input' && typeof event.data === 'string' && event.data.length < 16384) ws.data.child?.terminal?.write(event.data);
        if (event.type === 'resize') ws.data.child?.terminal?.resize(clamp(event.cols, 40, 250), clamp(event.rows, 12, 100));
      } catch { /* Ignore malformed terminal events. */ }
    },
    close(ws) { ws.data.child?.kill(); ws.data.child?.terminal?.close(); if (ws.data.child) children.delete(ws.data.child); },
  },
});
console.log(`Scripture development preview: http://127.0.0.1:${server.port}`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { for (const child of children) child.kill(); server.stop(true); process.exit(0); });
