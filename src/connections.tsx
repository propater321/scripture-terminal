import { ScriptureText } from './scripture-text';
import { useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import type { KeyEvent, ScrollBoxRenderable } from '@opentui/core';
import { Action, HoverBox, type Palette } from './controls';
import { editionName, type ScriptureStore, type Translation, type Verse } from './store';
import { containsVerse, rangeKey, singleVerse, type PassageRange } from './references';

export type ExploreHandle = { key: (key: KeyEvent) => boolean; follow(range: PassageRange, edition?: Translation): void };
export type ConnectionKind = 'Cross-reference' | 'Chapter context';
type Props = {
  ref?: Ref<ExploreHandle>; active: boolean; store: ScriptureStore; selected: Verse; translation: Translation;
  p: Palette; width: number; height: number; reader: ReactNode;
  onNavigate: (verse: Verse) => void; onClose: () => void; onExplain: (range: PassageRange, from: PassageRange, kind: ConnectionKind) => void;
};
type Connection = { range: PassageRange; kind: ConnectionKind };
const pageSize = 6;

export function Connections({ ref, active, store, selected, translation, p, width, height, reader, onNavigate, onClose, onExplain }: Props) {
  const contextLabel = store.profile.id === 'bible' || store.profile.id === 'torah' ? 'Chapter context' : 'Section context';
  const [trail, setTrail] = useState<PassageRange[]>(() => [singleVerse(selected)]);
  const [linksOn, setLinksOn] = useState(true);
  const [contextOn, setContextOn] = useState(false);
  const [page, setPage] = useState(0);
  const [cursor, setCursor] = useState(-1);
  const [hover, setHover] = useState<number | null>(null);
  const [focus, setFocus] = useState<'links' | 'text'>('links');
  const [notice, setNotice] = useState('');
  const listRef = useRef<ScrollBoxRenderable>(null);
  const previewRef = useRef<ScrollBoxRenderable>(null);
  const current = trail.at(-1)!;
  const currentKey = rangeKey(current);
  const showReader = width >= 140 && height >= 30;
  const narrow = width < 100;
  const short = height < 24;
  const references = useMemo(() => store.crossReferences(current), [store, currentKey]);
  const pages = Math.max(1, Math.ceil(references.references.length / pageSize));
  const visiblePage = Math.min(page, pages - 1);
  const connections = useMemo(() => {
    const result: Connection[] = linksOn ? references.references.slice(visiblePage * pageSize, (visiblePage + 1) * pageSize).map(link => ({ range: link.range, kind: 'Cross-reference' })) : [];
    if (contextOn) {
      const before = store.chapter(current.start.book_id, current.start.chapter, translation).filter(v => v.verse < current.start.verse).at(-1);
      const after = store.chapter(current.end.book_id, current.end.chapter, translation).find(v => v.verse > current.end.verse);
      for (const verse of [before, after]) if (verse) {
        const range = singleVerse(verse);
        if (!result.some(item => rangeKey(item.range) === rangeKey(range))) result.push({ range, kind: 'Chapter context' });
      }
    }
    return result;
  }, [store, references, linksOn, contextOn, visiblePage, currentKey, translation]);
  const previewIndex = hover ?? cursor;
  const connection = connections[previewIndex];
  const previewRange = connection?.range ?? current;
  const previewKey = rangeKey(previewRange);
  const preview = useMemo(() => store.passage(previewRange, translation), [store, previewKey, translation]);

  function resetPreview() { setCursor(-1); setHover(null); setNotice(''); setFocus('links'); }
  function follow(range: PassageRange, backIndex?: number, edition = translation) {
    const first = store.passage(range, edition, 1).verses[0];
    if (!first) { setNotice(`This passage is absent in ${editionName(translation)}. Try v to switch translation.`); return; }
    if (backIndex !== undefined) setTrail(currentTrail => currentTrail.slice(0, backIndex + 1));
    else if (rangeKey(range) !== currentKey) setTrail(currentTrail => [...currentTrail, range].slice(-50));
    setPage(0); resetPreview(); onNavigate(first);
  }
  function back() { if (trail.length > 1) follow(trail[trail.length - 2], trail.length - 2); }
  function changePage(delta: number) { setPage(Math.max(0, Math.min(pages - 1, visiblePage + delta))); resetPreview(); listRef.current?.scrollTo(0); }
  function toggleLinks() { setLinksOn(value => !value); resetPreview(); }
  function toggleContext() { setContextOn(value => !value); resetPreview(); }
  function move(delta: number) {
    setHover(null);
    setCursor(value => !connections.length ? -1 : Math.max(0, Math.min(connections.length - 1, value + delta)));
  }
  useEffect(() => {
    if (!containsVerse(current, selected)) {
      setTrail(previous => [...previous, singleVerse(selected)].slice(-50)); setPage(0); setCursor(-1); setHover(null); setNotice('');
    }
  }, [selected.book_id, selected.chapter, selected.verse]);
  useEffect(() => { setHover(null); setCursor(-1); }, [translation]);
  useEffect(() => { previewRef.current?.scrollTo(0); }, [previewKey, translation]);
  useEffect(() => {
    const timer = setTimeout(() => { if (cursor >= 0) listRef.current?.scrollChildIntoView(`connection-${cursor}`); }, 20);
    return () => clearTimeout(timer);
  }, [cursor, visiblePage, active]);
  useImperativeHandle(ref, () => ({ follow(range, edition) { follow(range, undefined, edition); }, key(key) {
    if (!active) return false;
    const name = key.sequence || key.name;
    if (key.name === 'backspace') { back(); return true; }
    if (name === 'l') { toggleLinks(); return true; }
    if (name === 't') { toggleContext(); return true; }
    if (name === 'n') { changePage(1); return true; }
    if (name === 'p') { changePage(-1); return true; }
    if (key.name === 'tab') { setFocus(value => value === 'links' ? 'text' : 'links'); setHover(null); return true; }
    if (focus === 'text' && showReader) return false;
    if (key.name === 'pagedown' || key.name === 'pageup') { previewRef.current?.scrollBy(key.name === 'pagedown' ? 8 : -8); return true; }
    if (key.name === 'down' || name === 'j') { if (focus === 'text') previewRef.current?.scrollBy(1); else move(1); return true; }
    if (key.name === 'up' || name === 'k') { if (focus === 'text') previewRef.current?.scrollBy(-1); else move(-1); return true; }
    if (key.name === 'return' || key.name === 'right') { if (connection) follow(connection.range); return true; }
    if (key.name === 'left') { back(); return true; }
    if (name === 'i' && connection && preview.verses.length) { onExplain(connection.range, current, connection.kind); return true; }
    return false;
  } }));

  if (!active) return null;
  const crumbCount = width >= 100 ? 3 : 1;
  const crumbWidth = Math.max(12, Math.floor((width - 23) / crumbCount));
  const shorten = (label: string) => label.length > crumbWidth ? label.slice(0, crumbWidth - 1) + '…' : label;
  const list = <box width={narrow ? '100%' : showReader ? 32 : 36} height={narrow ? Math.max(4, Math.min(10, Math.floor((height - 11) / 2))) : undefined} flexShrink={0} minHeight={0} backgroundColor={p.panel} border={['top']} borderColor={focus === 'links' ? p.accent : p.line} onMouseDown={() => setFocus('links')}>
    <HoverBox p={p} height={short ? 1 : 2} flexShrink={0} paddingX={1} active backgroundColor={p.selected} onHover={inside => { if (inside) setHover(-1); }} onMouseDown={() => { setCursor(-1); setHover(null); }}><text fg={p.accent}>● {store.rangeLabel(current)}</text></HoverBox>
    <scrollbox ref={listRef} flexGrow={1} minHeight={0} scrollX={false} scrollbarOptions={{ visible: false }}>
      {!store.links && linksOn && <box paddingX={1} paddingBottom={1}><text fg={p.muted}>{store.linksError ?? 'Cross-references are not installed. Run bun run import:links, then reopen Scripture. Chapter context is still available.'}</text></box>}
      {!linksOn && !contextOn && <box paddingX={1}><text fg={p.muted}>Choose Links or Context above.</text></box>}
      {!!store.links && linksOn && !references.total && <box paddingX={1}><text fg={p.muted}>No cross-references for this passage in the installed dataset. Try the Context toggle.</text></box>}
      {connections.map((item, index) => <HoverBox key={`${currentKey}-${rangeKey(item.range)}-${item.kind}`} id={`connection-${index}`} p={p} active={cursor === index} backgroundColor={cursor === index ? p.selected : p.panel} height={2} paddingX={1}
        onHover={inside => { if (inside) setHover(index); }} onMouseDown={() => follow(item.range)}>
        <text fg={previewIndex === index ? p.accent : p.fg}>{index === connections.length - 1 ? '└─' : '├─'} {store.rangeLabel(item.range)}</text>
        <text fg={p.muted}>   {item.kind === 'Chapter context' ? contextLabel : item.kind}{trail.some(range => rangeKey(range) === rangeKey(item.range)) ? ' · visited' : ''}</text>
      </HoverBox>)}
    </scrollbox>
    {linksOn && pages > 1 && <box height={1} flexShrink={0} flexDirection="row" justifyContent="space-between"><Action p={p} disabled={visiblePage === 0} onPress={() => changePage(-1)}>p Prev</Action><text fg={p.muted}>{visiblePage + 1}/{pages}</text><Action p={p} disabled={visiblePage === pages - 1} onPress={() => changePage(1)}>n More</Action></box>}
  </box>;
  const previewPane = <box flexGrow={showReader ? 0 : 1} width={showReader ? 36 : undefined} flexBasis={showReader ? 36 : undefined} flexShrink={showReader ? 0 : 1} minWidth={0} minHeight={0} backgroundColor={p.panel} border={[narrow ? 'top' : 'left']} borderColor={focus === 'text' && !showReader ? p.accent : p.line} onMouseDown={() => { if (!showReader) setFocus('text'); }}>
    <box height={short ? 1 : 2} paddingX={1} flexShrink={0}><text fg={p.accent}>PREVIEW · {preview.label}{short ? ` · ${editionName(translation)}` : ''}</text></box>
    <scrollbox ref={previewRef} flexGrow={1} minHeight={0} scrollX={false} scrollbarOptions={{ visible: false }} contentOptions={{ paddingX: 1 }}>
      {!short && <text fg={p.muted}>{connection?.kind === 'Chapter context' ? contextLabel : connection?.kind ?? 'Selected passage'} · {editionName(translation)}</text>}
      {!short && connection?.kind === 'Cross-reference' && <text fg={p.muted}>Source: {store.profile.linksSource}</text>}
      {!preview.verses.length ? <box marginTop={short ? 0 : 1}><text fg={p.accent}>This passage is not present in {editionName(translation)}. Press v to compare the other version.</text></box> : preview.verses.map((verse, index) => <box key={verse.id} marginTop={short && index === 0 ? 0 : 1}><text fg={p.muted}>{preview.total > 1 ? store.label(verse) : ''}</text><ScriptureText fg={p.fg} translation={verse.translation} text={verse.text} /></box>)}
      {preview.omitted && !!preview.verses.length && <box marginTop={1}><text fg={p.muted}>Some referenced verses are absent in {editionName(translation)}; showing the available text.</text></box>}
      {preview.total > preview.verses.length && <box marginTop={1}><text fg={p.muted}>Showing the first {preview.verses.length} of {preview.total} verses. Follow to read in context.</text></box>}
    </scrollbox>
    {connection && <box height={1} flexShrink={0} flexDirection="row" gap={1}><Action p={p} disabled={!preview.verses.length} onPress={() => follow(connection.range)}>Enter Follow</Action><Action p={p} disabled={!preview.verses.length} onPress={() => onExplain(connection.range, current, connection.kind)}>i Explain link</Action></box>}
  </box>;

  return <box flexGrow={1} minHeight={0} minWidth={0}>
    <box height={height < 30 ? 1 : 2} flexShrink={0} flexDirection="row" justifyContent="space-between"><text fg={p.accent}><strong>EXPLORE</strong></text><box flexDirection="row" gap={1}><Action p={p} active={linksOn} onPress={toggleLinks}>l Links {linksOn ? '✓' : '·'}</Action><Action p={p} active={contextOn} onPress={toggleContext}>t Context {contextOn ? '✓' : '·'}</Action><Action p={p} onPress={onClose}>x Close</Action></box></box>
    <box height={height < 30 ? 1 : 2} flexShrink={0} flexDirection="row" gap={1}><Action p={p} disabled={trail.length < 2} onPress={back}>⌫ Back</Action>{trail.length > crumbCount && <text fg={p.muted}>…</text>}{trail.slice(-crumbCount).map((range, index) => {
      const trailIndex = Math.max(0, trail.length - crumbCount) + index;
      return <Action p={p} key={`${trailIndex}-${rangeKey(range)}`} active={trailIndex === trail.length - 1} onPress={() => follow(range, trailIndex)}>{index ? '› ' : ''}{shorten(store.rangeLabel(range))}</Action>;
    })}</box>
    <box flexGrow={1} minHeight={0} minWidth={0} flexDirection={narrow ? 'column' : 'row'} gap={short ? 0 : 1}>
      {list}
      {showReader && <box flexGrow={1} flexBasis={0} minWidth={0} minHeight={0} border={['top']} borderColor={focus === 'text' ? p.accent : p.line} onMouseDown={() => setFocus('text')}>{reader}</box>}
      {previewPane}
    </box>
    <box height={1} flexShrink={0}><text fg={notice ? p.accent : p.muted}>{notice || (width >= 100 ? `Hover previews · Enter follows · ⌫ back · ${references.total.toLocaleString()} links${references.total > references.references.length ? ' (top 1,000)' : ''} · ${store.profile.linksCredit}` : '↑↓ preview · Enter follow · ⌫ back · PgDn scroll')}</text></box>
  </box>;
}
