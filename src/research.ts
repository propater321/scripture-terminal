import type { BibleSearch, PassageHit } from './search';
import { editionName, type ScriptureStore, type Translation, type Verse } from './store';
import type { StudyRequest, StudyProgress, StudyTools } from './study';
import { addressKey, type PassageRange } from './references';

const object = (properties: Record<string, unknown>, required: string[]) => ({ type: 'object', properties, required, additionalProperties: false });
const versionSchema = { type: 'string', enum: ['WEB', 'KJV'], description: 'Translation. Use the reader’s translation unless comparison is requested.' };
export const bibleToolDefinitions = [
  { type: 'function', name: 'bible_search', description: 'Search the whole Bible with local semantic embeddings and keyword search. Returns candidate passages and source IDs; relevance is not proof of an interpretation. Try alternate wording when useful.', inputSchema: object({ query: { type: 'string', minLength: 1, maxLength: 4000 }, translation: versionSchema, refine: { type: 'boolean', description: 'Optionally rerank candidates with a local cross-encoder for a closer relevance comparison.' }, book_id: { type: 'integer', minimum: 1, maximum: 66, description: 'Optional filter in the standard 66-book order; omit to search all books.' } }, ['query']) },
  { type: 'function', name: 'bible_read', description: 'Read exact Bible text and register citable source IDs. Use to inspect context, verify a remembered reference, or compare translations. Accepts a chapter or passage range, e.g. Matthew 6, Matthew 6:25-34, or Mark 3:35-4:2.', inputSchema: object({ reference: { type: 'string', maxLength: 200 }, translation: versionSchema }, ['reference']) },
  { type: 'function', name: 'bible_connections', description: 'Find editorial cross-references from OpenBible.info for a passage. Returns references, not citable text: read them with bible_read before citing.', inputSchema: object({ reference: { type: 'string', maxLength: 200 } }, ['reference']) },
];

export async function wholeBibleRequest(store: ScriptureStore, search: BibleSearch, question: string, translation: Translation, signal: AbortSignal, onProgress: (progress: StudyProgress) => void): Promise<StudyRequest> {
  question = question.trim();
  if (!question || question.length > 4000) throw new Error('Enter a question of 1–4,000 characters.');
  signal.throwIfAborted();
  if (!store.profile.editions.includes(translation)) throw new Error('Edition does not belong to this library.');
  const prefix = store.profile.id;
  const definitions = store.profile.id === 'bible' ? bibleToolDefinitions : bibleToolDefinitions.map(tool => {
    const schema = structuredClone(tool.inputSchema) as any;
    if (schema.properties.translation) schema.properties.translation.enum = store.profile.editions;
    if (schema.properties.book_id) { schema.properties.book_id.maximum = store.books.length; schema.properties.book_id.description = `Optional text ID from 1 through ${store.books.length}.` ; }
    return { ...tool, name: tool.name.replace('bible_', prefix+'_'), inputSchema: schema, description: tool.description.replaceAll('Bible', store.profile.name).replaceAll('bible_', prefix+'_').replace('OpenBible.info', 'Sefaria').replace('Matthew 6, Matthew 6:25-34, or Mark 3:35-4:2', store.profile.id==='torah' ? 'Exodus 20, Exodus 20:1-14, or Genesis 1:31-2:3' : store.label(store.chapter(1,1,store.profile.defaultEdition)[0])) };
  });
  const request: StudyRequest = { collection: store.profile.id, corpusName: store.profile.name, corpusSize: store.books.length, question, passage: `Whole ${store.profile.name} · ${editionName(translation)}`, scope: 'bible', sources: [], searches: [] };
  const byVerse = new Map<number, string>();
  const sourceLimit = 240;
  let calls = 0;
  function assertRoom(verses: Verse[]) {
    const additions = new Set(verses.filter(verse => !byVerse.has(verse.id)).map(verse => verse.id));
    if (request.sources.length + additions.size > sourceLimit || request.sources.reduce((n,s)=>n+s.verse.text.length,0)+verses.filter(v=>!byVerse.has(v.id)).reduce((n,v)=>n+v.text.length,0)>120000) throw new Error('Evidence budget reached. Answer from the passages already retrieved, noting any gaps.');
  }
  function add(verses: Verse[]) {
    assertRoom(verses);
    return verses.map(verse => {
      let id = byVerse.get(verse.id);
      if (!id) {
        id = `S${request.sources.length + 1}`; byVerse.set(verse.id, id);
        request.sources.push({ id, label: `${store.label(verse)} · ${editionName(verse.translation)}`, edition: store.sourcesFor?.(verse.book_id).find(s=>s.edition===verse.translation)?.versionTitle, verse });
      }
      return { id, reference: `${store.label(verse)} · ${editionName(verse.translation)}`, edition: request.sources.find(s => s.id === id)?.edition, text: verse.text };
    });
  }
  function version(args: Record<string, unknown>): Translation {
    const value = args.translation ?? translation;
    if (!store.profile.editions.includes(value as Translation)) throw new Error(`Translation must be ${store.profile.editions.join(' or ')}.`);
    return value as Translation;
  }
  function reference(value: unknown, selectedVersion: Translation): PassageRange {
    if (typeof value !== 'string' || value.length > 200) throw new Error('Provide a chapter or verse reference.');
    if (store.resolveReference) return store.resolveReference(value, selectedVersion);
    const parts = value.replace(/[–—]/g, '-').split('-').map(part => part.trim());
    if (parts.length > 2) throw new Error('Provide one passage range at a time.');
    const ref = store.parseReference(parts[0]);
    if (!ref) throw new Error(`Reference not recognized. Use e.g. ${store.books[0].name} 1:1-5.`);
    const chapter = store.chapter(ref.book.id, ref.chapter, selectedVersion);
    if (!chapter.length) throw new Error('Chapter unavailable.');
    const hasVerse = /[:.]\d/.test(parts[0]);
    const range = { start: { book_id: ref.book.id, chapter: ref.chapter, verse: hasVerse ? ref.verse : chapter[0].verse }, end: { book_id: ref.book.id, chapter: ref.chapter, verse: hasVerse ? ref.verse : chapter.at(-1)!.verse } };
    if (parts[1]) {
      if (/^\d+$/.test(parts[1]) && hasVerse) range.end.verse = Number(parts[1]);
      else {
        const endRef = store.parseReference(/^\d/.test(parts[1]) && !/[a-z]/i.test(parts[1]) ? `${ref.book.name} ${parts[1]}` : parts[1]);
        if (!endRef) throw new Error('Range endpoint not recognized.');
        const endChapter = store.chapter(endRef.book.id, endRef.chapter, selectedVersion);
        if (!endChapter.length) throw new Error('Range endpoint chapter unavailable.');
        range.end = { book_id: endRef.book.id, chapter: endRef.chapter, verse: /[:.]\d/.test(parts[1]) ? endRef.verse : endChapter.at(-1)!.verse };
      }
    }
    if (range.end.verse < 1 || addressKey(range.end) < addressKey(range.start)) throw new Error('Passage range is reversed or invalid.');
    return range;
  }
  function materialize(hit: PassageHit) {
    const passage = store.passage(hit.range, hit.translation);
    return { reference: hit.label, translation: hit.translation, matchedBy: hit.channels, sources: add(passage.verses) };
  }
  async function find(query: string, selectedVersion: Translation, book?: number, refine = false) {
    onProgress({ status: `Searching the ${store.profile.name}: ${query.slice(0, 90)}` });
    const result = await search.search(query, selectedVersion, { book, limit: 6, rerank: refine, signal });
    signal.throwIfAborted();
    request.searches!.push({ query, mode: result.reranked ? `${result.mode} + rerank` : result.mode, references: result.hits.map(hit => hit.label), notice: result.notice });
    assertRoom(result.hits.flatMap(hit => store.passage(hit.range, hit.translation).verses));
    return { query, mode: result.mode, notice: result.notice, passages: result.hits.map(materialize) };
  }
  request.tools = {
    definitions,
    async call(name, arguments_) {
      signal.throwIfAborted();
      if (++calls > 8) throw new Error('Search/read budget reached. Finish using the retrieved evidence and state any limits.');
      if (!arguments_ || typeof arguments_ !== 'object' || Array.isArray(arguments_)) throw new Error('Tool arguments must be an object.');
      const args = arguments_ as Record<string, unknown>;
      if (name === `${prefix}_search`) {
        if (typeof args.query !== 'string' || !args.query.trim() || args.query.length > 4000) throw new Error('Provide a search query of 1–4,000 characters.');
        if (args.book_id !== undefined && (!Number.isInteger(args.book_id) || Number(args.book_id) < 1 || Number(args.book_id) > store.books.length)) throw new Error(`Book ID must be between 1 and ${store.books.length}.`);
        if (args.refine !== undefined && typeof args.refine !== 'boolean') throw new Error('Refine must be true or false.');
        return find(args.query, version(args), args.book_id as number | undefined, args.refine === true);
      }
      if (name === `${prefix}_read`) {
        const selectedVersion = version(args), range = reference(args.reference, selectedVersion);
        onProgress({ status: `Reading ${store.rangeLabel(range)} · ${selectedVersion}` });
        const passage = store.passage(range, selectedVersion, 60);
        return { reference: passage.label, translation: selectedVersion, availableVerses: passage.total, truncated: passage.total > passage.verses.length, omittedVerses: passage.omitted, sources: add(passage.verses) };
      }
      if (name === `${prefix}_connections`) {
        const range = reference(args.reference, translation);
        onProgress({ status: `Following references from ${store.rangeLabel(range)}` });
        const links = store.crossReferences(range, 8);
        return { source: store.profile.linksCredit, note: 'Editorial study aids within this library. Read each passage before using it as evidence.', total: links.total, references: links.references.map(link => store.rangeLabel(link.range).replaceAll('–', '-')) };
      }
      throw new Error(`Unknown ${store.profile.name} tool.`);
    },
  } satisfies StudyTools;
  const initial = await find(question, translation);
  request.retrieval = initial;
  return request;
}
