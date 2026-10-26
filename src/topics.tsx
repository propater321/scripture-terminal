import { ScriptureText } from './scripture-text';
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import type { KeyEvent, ScrollBoxRenderable } from '@opentui/core';
import { Action, HoverBox, scrollIndicators, type Palette } from './controls';
import { topicSuggestions } from './library';
import { editionName, type ScriptureStore, type Translation, type Verse } from './store';
import type { BibleSearch, PassageSearch } from './search';
import type { PassageRange } from './references';
export type TopicsHandle = { key(key: KeyEvent): boolean | 'input'; search(query: string): void };

export function Topics({ ref, active, store, search, translation, p, width, height, onRead, onConnections, onAsk }: {
  ref?: Ref<TopicsHandle>; active: boolean; store: ScriptureStore; search: BibleSearch; translation: Translation; p: Palette; width: number; height: number;
  onRead(verse: Verse): void; onConnections(range: PassageRange, translation: Translation): void; onAsk(question: string): void;
}) {
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [result, setResult] = useState<PassageSearch | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [cursor, setCursor] = useState(0), [bookFilter, setBookFilter] = useState<number | undefined>();
  const [focus, setFocus] = useState<'results' | 'preview'>('results');
  const [refine, setRefine] = useState(false);
  const [searchedTranslation, setSearchedTranslation] = useState(translation);
  const lastSearch = useRef<{ query: string; filter?: number; rerank: boolean } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const resultsRef = useRef<ScrollBoxRenderable>(null), previewRef = useRef<ScrollBoxRenderable>(null);
  const suggestionsRef = useRef<ScrollBoxRenderable>(null);
  const wide = width >= 110 && height >= 28;
  const hit = result?.hits[cursor];
  const passage = hit ? store.passage(hit.range, hit.translation) : null;
  const books = [...new Set(result?.hits.map(hit => hit.range.start.book_id) ?? [])];
  async function run(query: string, filter?: number, rerank = refine) {
    if (!query.trim()) return;
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    lastSearch.current = { query, filter, rerank };
    setDraft(query); setEditing(false); setBusy(true); setError(''); setResult(null); setBookFilter(filter); setSearchedTranslation(translation);
    try {
      const response = await search.search(query, translation, { book: filter, limit: 20, rerank, signal: abort.signal });
      if (abort.signal.aborted) return;
      setResult(response); setCursor(0); setFocus('results'); resultsRef.current?.scrollTo(0); previewRef.current?.scrollTo(0);
    } catch (error) { if (!abort.signal.aborted) setError((error as Error).message); }
    finally { if (controller.current === abort) { setBusy(false); controller.current = null; } }
  }
  function read() { if (passage?.verses[0]) onRead(passage.verses[0]); }
  function stop() { controller.current?.abort(); controller.current = null; setBusy(false); }
  function toggleRefine() { setRefine(value => !value); if (result) void run(result.query, bookFilter, !refine); }
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (translation !== searchedTranslation && lastSearch.current) {
      const { query, filter, rerank } = lastSearch.current;
      void run(query, filter, rerank);
    }
  }, [translation]);
  useEffect(() => { previewRef.current?.scrollTo(0); }, [cursor, result]);
  useEffect(() => {
    const timer = setTimeout(() => resultsRef.current?.scrollChildIntoView(`topic-hit-${cursor}`), 30);
    return () => clearTimeout(timer);
  }, [cursor, active, width]);
  useImperativeHandle(ref, () => ({ search(query) { void run(query); }, key(key) {
    if (!active) return false;
    const name = key.sequence || key.name;
    if (editing) { if (key.name === 'escape') { setEditing(false); return true; } return 'input'; }
    if (key.name === 'escape' && busy) { stop(); return true; }
    if (name === '/' || name === 'e') { if (name === '/') setDraft(''); setEditing(true); return true; }
    if (name === 'z') { toggleRefine(); return true; }
    if (key.name === 'tab') { setFocus(value => value === 'results' ? 'preview' : 'results'); return true; }
    if (key.name === 'return') { if (hit) read(); else setEditing(true); return true; }
    if (key.name === 'down' || name === 'j') { if (!result) suggestionsRef.current?.scrollBy(2); else if (focus === 'preview' && wide) previewRef.current?.scrollBy(2); else setCursor(i => Math.min(Math.max(0, result.hits.length - 1), i + 1)); return true; }
    if (key.name === 'up' || name === 'k') { if (!result) suggestionsRef.current?.scrollBy(-2); else if (focus === 'preview' && wide) previewRef.current?.scrollBy(-2); else setCursor(i => Math.max(0, i - 1)); return true; }
    if (key.name === 'pageup' || key.name === 'pagedown') { (!result ? suggestionsRef : focus === 'preview' && wide ? previewRef : resultsRef).current?.scrollBy(key.name === 'pagedown' ? 8 : -8); return true; }
    if (name === 'g' && hit) { onConnections(hit.range, hit.translation); return true; }
    if (name === 'i' && result) { onAsk(result.query); return true; }
    return false;
  } }));
  return <box flexGrow={1} minHeight={0} minWidth={0}>
    <HoverBox p={p} height={3} flexShrink={0} flexDirection="row" gap={1} border borderColor={editing ? p.accent : p.line} hoverBorder={p.accent} paddingX={1} onMouseDown={() => setEditing(true)}>
      {editing ? <input id="topic-input" flexGrow={1} flexBasis={0} minWidth={0} focused={active} value={draft} onInput={setDraft} onSubmit={() => { void run(draft); }} placeholder="A topic or question, e.g. finding peace" textColor={p.fg} focusedTextColor={p.fg} backgroundColor={p.bg} focusedBackgroundColor={p.bg} cursorColor={p.accent} /> : <text flexGrow={1} flexBasis={0} minWidth={0} maxHeight={1} fg={draft ? p.fg : p.muted}>{draft.length > width - 19 ? `${draft.slice(0, width - 20)}…` : draft || 'A topic or question, e.g. finding peace'}</text>}
      <Action p={p} primary disabled={!busy && !draft.trim()} onPress={() => { if (busy) stop(); else void run(draft); }}>{busy ? 'Stop' : 'Search'}</Action>
    </HoverBox>
    {!result && !busy && <scrollbox ref={suggestionsRef} flexGrow={1} minHeight={0} scrollX={false} {...scrollIndicators(p)}><box marginTop={1}><text fg={p.fg}>What would you like to explore?</text><text fg={p.muted}>Choose a topic, or search in your own words.</text><box flexDirection="row" flexWrap="wrap" gap={1} marginTop={1}>{(store.profile.id === 'torah' ? [{label:'Covenant',query:'covenant with Abraham and Israel'}, {label:'Shabbat',query:'Sabbath rest and holiness'}, {label:'Justice',query:'justice for the stranger and the poor'}, {label:'Freedom',query:'freedom from slavery in Egypt'}, {label:'Forgiveness',query:'repentance and forgiveness'}, {label:'שבת',query:'שמירת שבת ומנוחה'}] : store.profile.id !== 'bible' ? (store.profile.id === 'zohar' ? ['Creation and light', 'The soul', 'Prayer', 'The Sabbath', 'Wisdom'] : ['Prayer and intention', 'Sabbath rest', 'Justice and charity', 'Study and teaching', 'Disagreements between sages', 'שבת']).map(query => ({label:query,query})) : topicSuggestions).map(topic => <Action p={p} key={topic.label} onPress={() => { void run(topic.query); }}>{topic.label} →</Action>)}</box></box></scrollbox>}
    {busy && <box height={1} flexShrink={0}><text fg={p.accent}>Searching words and meaning locally… <span fg={p.muted}>Esc stop</span></text></box>}
    {!!error && <box flexShrink={0}><text fg={p.accent}>{error}</text></box>}
    {result && <>
      <box height={1} flexShrink={0} flexDirection="row" justifyContent="space-between"><text fg={p.muted}>{result.hits.length} passages · {result.mode === 'hybrid' ? 'keywords + meaning' : result.mode}{result.reranked ? ' · refined' : ''}</text><Action p={p} active={refine} disabled={busy} onPress={toggleRefine}>{refine ? '☑' : '☐'} Refine</Action></box>
      {!!result.notice && <box flexShrink={0}><text fg={p.accent}>{result.notice}</text></box>}
      <box flexShrink={0} flexDirection="row" flexWrap="wrap" gap={1} marginBottom={height >= 28 ? 1 : 0}>
        <Action p={p} active={!bookFilter} onPress={() => { void run(result.query); }}>All {store.profile.bookTerm ?? 'books'}</Action>
        {width >= 100 ? books.map(id => <Action p={p} key={id} active={bookFilter === id} onPress={() => { void run(result.query, id); }}>{store.book(id).osis}</Action>) : <text fg={p.muted}>{bookFilter ? store.book(bookFilter).name : `${books.length} ${store.profile.bookTerm ?? 'books'} in these matches`} · {editionName(translation)}</text>}
      </box>
      <box flexGrow={1} minHeight={0} minWidth={0} flexDirection="row" gap={1}>
        <box flexGrow={1} flexBasis={0} minWidth={0} minHeight={0} backgroundColor={p.panel} border={['top']} borderColor={focus === 'results' ? p.accent : p.line} onMouseDown={() => setFocus('results')}>
          <scrollbox ref={resultsRef} flexGrow={1} minHeight={0} scrollX={false} {...scrollIndicators(p)}>
            {!result.hits.length && <box padding={1}><text fg={p.muted}>No candidate passages. Try a different description or clear the book filter.</text></box>}
            {result.hits.map((item, index) => <HoverBox key={item.id} id={`topic-hit-${index}`} p={p} paddingX={1} paddingBottom={1} active={index === cursor} backgroundColor={index === cursor ? p.selected : p.panel}
              onHover={inside => { if (inside) setCursor(index); }} onMouseDown={() => { const verse = store.passage(item.range, item.translation, 1).verses[0]; if (verse) onRead(verse); }}>
              <text fg={index === cursor ? p.accent : p.fg}><strong>{item.label}</strong> <span fg={p.muted}>{item.translation !== translation ? `${editionName(item.translation)} · ` : ''}→ read</span></text>
              <ScriptureText fg={p.muted} maxHeight={wide ? 3 : 2} text={item.text} translation={item.translation} />
            </HoverBox>)}
          </scrollbox>
        </box>
        {wide && <box width={Math.min(52, Math.floor(width * 0.4))} flexShrink={0} minHeight={0} backgroundColor={p.panel} border={['left']} borderColor={focus === 'preview' ? p.accent : p.line} onMouseDown={() => setFocus('preview')}>
          <box height={2} paddingX={1} flexShrink={0}><text fg={p.accent}>{passage?.label ?? 'PASSAGE PREVIEW'}</text></box>
          <scrollbox ref={previewRef} flexGrow={1} minHeight={0} scrollX={false} {...scrollIndicators(p)} contentOptions={{ paddingX: 1 }}>
            {passage?.verses.map(verse => <box key={verse.id} marginBottom={1}><text fg={p.muted}>{verse.verse}</text><ScriptureText fg={p.fg} translation={verse.translation} text={verse.text} /></box>)}
          </scrollbox>
          {hit && <box height={1} flexShrink={0} flexDirection="row" gap={1}><Action p={p} primary onPress={read}>Read {store.profile.unitTerm ?? 'chapter'} ↵</Action><Action p={p} onPress={() => onConnections(hit.range, hit.translation)}>Related passages</Action></box>}
        </box>}
      </box>
      <box height={1} flexShrink={0} flexDirection="row" gap={1}><Action p={p} onPress={() => onAsk(result.query)}>Ask Codex about this [i]</Action>{!wide && hit && <Action p={p} primary onPress={read}>Read {store.profile.unitTerm ?? 'chapter'} ↵</Action>}</box>
    </>}
    <box height={1} flexShrink={0}><text fg={p.muted}>{result ? '↑↓ browse · Enter read · / new search · z refine' : 'Search is local · Ask uses your Codex subscription'}</text></box>
  </box>;
}
