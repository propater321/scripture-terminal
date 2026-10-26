import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from 'react';
import type { KeyEvent } from '@opentui/core';
import { Action, type Palette } from './controls';
import { Connections, type ExploreHandle as ConnectionsHandle, type ConnectionKind } from './connections';
import { LibraryView, type LibraryHandle } from './library-view';
import { Topics, type TopicsHandle } from './topics';
import type { ScriptureStore, Translation, Verse } from './store';
import type { BibleSearch } from './search';
import type { PassageRange } from './references';
export type { ConnectionKind } from './connections';
export type ExploreHandle = { key(key: KeyEvent): boolean | 'input' };
export function Explore({ ref, active, inputActive = true, store, search, selected, translation, p, width, height, reader, onNavigate, onRead, onClose, onExplain, onAsk, onViewChange }: {
  ref?: Ref<ExploreHandle>; active: boolean; inputActive?: boolean; store: ScriptureStore; search: BibleSearch; selected: Verse; translation: Translation;
  p: Palette; width: number; height: number; reader: ReactNode; onNavigate(verse: Verse): void; onRead(verse: Verse): void;
  onClose(): void; onExplain(range: PassageRange, from: PassageRange, kind: ConnectionKind): void; onAsk(question: string): void;
  onViewChange?(view: string): void;
}) {
  const [view, setView] = useState<'books' | 'topics' | 'connections'>('books');
  useEffect(() => { onViewChange?.(view === 'books' ? (store.profile.bookTerm ?? 'Books') : view === 'topics' ? 'Topics' : 'Connections'); }, [view, onViewChange]);
  const libraryRef = useRef<LibraryHandle>(null), topicsRef = useRef<TopicsHandle>(null), connectionsRef = useRef<ConnectionsHandle>(null);
  function topic(query: string) { setView('topics'); topicsRef.current?.search(query); }
  function connect(range: PassageRange, edition: Translation) { connectionsRef.current?.follow(range, edition); setView('connections'); }
  useImperativeHandle(ref, () => ({ key(key) {
    if (!active) return false;
    const handled = view === 'books' ? libraryRef.current?.key(key) : view === 'topics' ? topicsRef.current?.key(key) : connectionsRef.current?.key(key);
    if (handled) return handled;
    const name = key.sequence || key.name;
    if (name === 'o') { setView('books'); return true; }
    if (name === 'u') { setView('topics'); return true; }
    if (name === 'g') { setView('connections'); return true; }
    return false;
  } }));
  return <box visible={active} flexGrow={1} minHeight={0} minWidth={0}>
    <box height={height < 24 ? 1 : 2} flexShrink={0} flexDirection="row" justifyContent="space-between">
      {width >= 90 && <text fg={p.accent}><strong>EXPLORE THE {store.profile.name.toUpperCase()}</strong></text>}
      <box flexDirection="row" gap={1}><Action p={p} active={view === 'books'} onPress={() => setView('books')}>{(store.profile.bookTerm ?? 'Books').replace(/^./, c => c.toUpperCase())} [o]</Action><Action p={p} active={view === 'topics'} onPress={() => setView('topics')}>Topics [u]</Action><Action p={p} active={view === 'connections'} onPress={() => setView('connections')}>{width >= 80 ? 'Connections [g]' : 'Links [g]'}</Action></box>
      {view === 'connections' && width >= 110 && <Action p={p} onPress={onClose}>Back to reading</Action>}
    </box>
    <box visible={view === 'books'} flexGrow={1} minHeight={0}><LibraryView ref={libraryRef} active={active && inputActive && view === 'books'} store={store} selected={selected} translation={translation} p={p} width={width} onRead={onRead} onTopic={topic} /></box>
    <box visible={view === 'topics'} flexGrow={1} minHeight={0}><Topics ref={topicsRef} active={active && inputActive && view === 'topics'} store={store} search={search} translation={translation} p={p} width={width} height={height} onRead={onRead} onConnections={connect} onAsk={onAsk} /></box>
    <Connections ref={connectionsRef} active={active && view === 'connections'} store={store} selected={selected} translation={translation} p={p} width={width} height={height - 2} reader={reader} onNavigate={onNavigate} onClose={onClose} onExplain={onExplain} />
  </box>;
}
