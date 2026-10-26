// Explicit end-to-end check: one question uses the existing Codex subscription.
import { strict as assert } from 'node:assert';
import { BibleStore } from '../src/store';
import { HybridSearch } from '../src/search';
import { wholeBibleRequest } from '../src/research';
import { askCodex } from '../src/codex';
const store = new BibleStore(':memory:'), search = new HybridSearch(store);
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 210_000);
try {
  const request = await wholeBibleRequest(store, search, 'What does the Bible say about anxiety and finding peace? Please consider more than one book.', 'WEB', controller.signal, progress => console.log(progress.status));
  const calls: { name: string; args: unknown }[] = [];
  const call = request.tools!.call.bind(request.tools);
  request.tools!.call = async (name, args) => { calls.push({name,args}); console.log(`Tool: ${name}`); return call(name,args); };
  const answer = await askCodex(request, controller.signal, progress => console.log(progress.status));
  assert.ok(calls.some(call=>call.name==='bible_read'), 'Agent must verify passage context through a real tool call.');
  assert.ok(answer.sources.length > 0);
  assert.ok(answer.sources.every(source=>store.verse(source.verse.book_id,source.verse.chapter,source.verse.verse,source.verse.translation)?.text===source.verse.text));
  assert.ok(!answer.insufficientEvidence);
  await Bun.write(new URL('../previews/research-answer.json',import.meta.url), JSON.stringify({question:request.question,calls,answer},null,2));
  console.log(JSON.stringify({model:answer.model,toolCalls:calls.length,citedVerses:answer.sources.length,books:[...new Set(answer.sources.map(source=>store.book(source.verse.book_id).name))],answer:answer.answer},null,2));
} finally { clearTimeout(timer); controller.abort(); search.close(); store.close(); }
