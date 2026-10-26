import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import type { KeyEvent, ScrollBoxRenderable } from '@opentui/core';
import { Action, HoverBox, scrollIndicators, type Palette } from './controls';
import { bookGroups as bibleGroups, guideFor, groupFor } from './library';
import { isRabbinicLibrary, unitName, type ScriptureStore, type Translation, type Verse } from './store';
export type LibraryHandle = { key(key: KeyEvent): boolean | 'input' };

export function LibraryView({ ref, active, store, translation, selected, p, width, onRead, onTopic }: {
  ref?: Ref<LibraryHandle>; active: boolean; store: ScriptureStore; translation: Translation; selected: Verse; p: Palette; width: number;
  onRead(verse: Verse): void; onTopic(query: string): void;
}) {
  const torah = store.profile.id === 'torah', rabbinic = isRabbinicLibrary(store), jewish = torah || rabbinic;
  const bookTerm = store.profile.bookTerm ?? 'books', unitTerm = store.profile.unitTerm ?? 'chapter';
  const bookGroups = jewish ? [...new Set(store.books.map(b => b.testament))].map(name => {
    const ids = store.books.filter(b => b.testament === name).map(b => b.id);
    return {name: torah ? 'THE FIVE BOOKS' : name, first: Math.min(...ids), last: Math.max(...ids), color: p.accent, testament: name};
  }) : bibleGroups;
  const [bookId, setBookId] = useState(1), [hoverId, setHoverId] = useState<number | null>(null);
  const [detail, setDetail] = useState(false), [chapters, setChapters] = useState(false);
  const [chapterNumber, setChapterNumber] = useState(1);
  const [testament, setTestament] = useState<'all' | 'OT' | 'NT'>('all');
  const [filter, setFilter] = useState(''), [editing, setEditing] = useState(false);
  const mapRef = useRef<ScrollBoxRenderable>(null), detailRef = useRef<ScrollBoxRenderable>(null);
  const wide = width >= 100;
  const previewId = hoverId ?? bookId, book = store.book(previewId), guide = store.bookGuide?.(previewId) ?? guideFor(previewId), group = bookGroups.find(g => previewId >= g.first && previewId <= g.last) ?? groupFor(previewId);
  const coverage = store.coverageFor?.(previewId);
  const mapWidth = wide ? width - 45 : width - 4;
  const tileWidth = rabbinic ? Math.min(32, mapWidth - 3) : 23;
  const columns = Math.max(1, Math.floor((mapWidth - 3) / tileWidth));
  const unitWidth = rabbinic ? 9 : 5;
  const chapterColumns = Math.max(1, Math.floor((wide ? 35 : width - 10) / unitWidth));
  const matching = store.books.filter(b => (testament === 'all' || b.testament === testament) && `${b.name} ${b.osis}`.toLowerCase().includes(filter.trim().toLowerCase()));
  const rows = bookGroups.flatMap(group => {
    const books = matching.filter(b => b.id >= group.first && b.id <= group.last);
    return Array.from({ length: Math.ceil(books.length / columns) }, (_, i) => books.slice(i * columns, (i + 1) * columns));
  });
  function read(chapter = chapters ? chapterNumber : 1) { const verse = store.chapter(previewId, chapter, translation)[0]; if (verse) onRead(verse); }
  function select(id: number) { setBookId(id); setHoverId(null); }
  function move(horizontal: number, vertical = 0) {
    const rowIndex = rows.findIndex(row => row.some(b => b.id === bookId));
    if (vertical) {
      const column = rows[rowIndex]?.findIndex(b => b.id === bookId) ?? 0;
      const next = rows[rowIndex + vertical];
      if (next) select(next[Math.min(Math.max(0, column), next.length - 1)].id);
    } else {
      const index = matching.findIndex(b => b.id === bookId);
      const next = matching[Math.max(0, Math.min(matching.length - 1, index + horizontal))];
      if (next) select(next.id);
    }
  }
  function findBook() { setTestament('all'); setFilter(''); setEditing(true); setDetail(false); setHoverId(null); }
  function changeFilter(value: string) {
    setFilter(value); setHoverId(null);
    const first = store.books.find(b => `${b.name} ${b.osis}`.toLowerCase().includes(value.trim().toLowerCase()));
    if (first) setBookId(first.id);
  }
  function filterTestament(value: 'all' | 'OT' | 'NT') {
    setTestament(value); setFilter(''); setEditing(false); setDetail(false);
    if (value !== 'all' && store.book(bookId).testament !== value) select(value === 'OT' ? 1 : 40);
    mapRef.current?.scrollTo(0);
  }
  useEffect(() => { detailRef.current?.scrollTo(0); setChapters(false); setChapterNumber(1); }, [previewId]);
  useEffect(() => { detailRef.current?.scrollTo(0); }, [chapters]);
  useEffect(() => {
    const timer = setTimeout(() => mapRef.current?.scrollChildIntoView(`library-book-${bookId}`), 30);
    return () => clearTimeout(timer);
  }, [bookId, active, width, testament, filter, detail]);
  useEffect(() => { if (chapters) detailRef.current?.scrollChildIntoView(`library-chapter-${chapterNumber}`); }, [chapterNumber, chapters]);
  useImperativeHandle(ref, () => ({ key(key) {
    if (!active) return false;
    const name = key.sequence || key.name;
    if (editing) {
      if (key.name === 'escape') { setEditing(false); return true; }
      return 'input';
    }
    if (name === '/') { findBook(); return true; }
    if (key.name === 'escape' || key.name === 'backspace') {
      if (chapters) { setChapters(false); return true; }
      if (detail) { setDetail(false); return true; }
      if (filter) { setFilter(''); return true; }
      return false;
    }
    if (key.name === 'tab') { setDetail(value => !value); setHoverId(null); return true; }
    if (key.name === 'return') { if (detail) read(); else if (matching.length) { setHoverId(null); setDetail(true); } return true; }
    if (name === 'h') { setDetail(true); setChapters(value => !value); setHoverId(null); return true; }
    if (key.name === 'pageup' || key.name === 'pagedown') { (detail ? detailRef : mapRef).current?.scrollBy(key.name === 'pagedown' ? 8 : -8); return true; }
    const down = key.name === 'down' || name === 'j', up = key.name === 'up' || name === 'k';
    const left = key.name === 'left', right = key.name === 'right';
    if (down || up || left || right) {
      if (detail && chapters) setChapterNumber(n => Math.min(book.chapters, Math.max(1, n + (down ? chapterColumns : up ? -chapterColumns : left ? -1 : 1))));
      else if (detail && (down || up)) detailRef.current?.scrollBy(down ? 2 : -2);
      else move(left ? -1 : right ? 1 : 0, down ? 1 : up ? -1 : 0);
      return true;
    }
    return false;
  } }));
  const details = <box width={wide ? 40 : '100%'} flexGrow={wide ? 0 : 1} flexShrink={0} minHeight={0} backgroundColor={p.panel} border={[wide ? 'left' : 'top']} borderColor={detail ? group.color : p.line}>
    <box minHeight={2} paddingX={1} flexShrink={0} flexDirection="row" justifyContent="space-between"><text flexGrow={1} flexBasis={0} minWidth={0} fg={group.color}><strong>{book.name.toUpperCase()}</strong></text>{!wide && <Action p={p} onPress={() => { setDetail(false); setChapters(false); }}>← {bookTerm}</Action>}</box>
    <box height={2} paddingX={1} flexShrink={0} flexDirection="row" gap={1}>
      <Action p={p} primary onPress={() => read()}>{rabbinic ? 'Read ' + unitName(store, book.id, chapters ? chapterNumber : 1) : `Read ${book.name} ${chapters ? chapterNumber : 1}`}</Action>
      <Action p={p} active={chapters} onPress={() => { setDetail(true); setChapters(value => !value); }}>{chapters ? 'Summary' : unitTerm.charAt(0).toUpperCase() + unitTerm.slice(1) + (unitTerm === 'daf' ? ' / amud' : 's')}</Action>
    </box>
    <scrollbox ref={detailRef} flexGrow={1} minHeight={0} scrollX={false} {...scrollIndicators(p)} contentOptions={{ paddingX: 1 }} onMouseDown={() => setDetail(true)}>
      <text fg={p.muted}>{jewish ? book.testament : book.testament === 'OT' ? 'Old Testament' : 'New Testament'} · {book.chapters} {unitTerm === 'daf' ? 'daf / amud' : unitTerm + 's'}</text>
      {chapters ? <>
        <box marginTop={1}><text fg={p.fg}>Choose a {unitTerm} to read</text></box>
        <box flexDirection="row" flexWrap="wrap" marginTop={1} paddingBottom={1}>{Array.from({ length: book.chapters }, (_, i) => <HoverBox p={p} key={i} id={`library-chapter-${i + 1}`} width={unitWidth} height={2} paddingX={1} active={chapterNumber === i + 1} backgroundColor={chapterNumber === i + 1 ? p.selected : p.panel} onMouseDown={() => read(i + 1)}><text fg={selected.book_id === book.id && selected.chapter === i + 1 ? p.accent : group.color}>{unitName(store, book.id, i + 1)}</text></HoverBox>)}</box>
      </> : <>
        <box marginTop={1}><text fg={p.fg}>{guide.summary}</text></box>{coverage && <box marginTop={1}><text fg={p.muted}>This work: {coverage.original.toLocaleString()} original · {coverage.english.toLocaleString()} English segments.</text>{coverage.english < coverage.segments && <text fg={p.accent}>English coverage is partial.</text>}{!coverage.original && <text fg={p.accent}>Original text is unavailable in this installed edition.</text>}</box>}
        <box marginTop={2}><text fg={group.color}>THEMES TO FOLLOW</text></box>
        <box flexDirection="row" flexWrap="wrap" gap={1} marginTop={1}>{guide.themes.map(theme => <Action p={p} key={theme} onPress={() => onTopic(theme)}>{theme} →</Action>)}</box>
        <box marginTop={2}><text fg={group.color}>PLACES TO BEGIN</text></box>
        {guide.highlights.map(highlight => <HoverBox p={p} key={highlight.chapter} marginTop={1} paddingX={1} backgroundColor={p.raised} onMouseDown={() => read(highlight.chapter)}><text fg={p.fg}>{highlight.label} →</text><text fg={p.muted}>{book.name} {unitName(store, book.id, highlight.chapter)}</text></HoverBox>)}
        <box marginTop={2} paddingBottom={1}><text fg={p.muted}>Summary for navigation · read the text for context.</text></box>
      </>}
    </scrollbox>
    <box height={1} paddingX={1} flexShrink={0}><text fg={p.muted}>{chapters ? 'Arrows choose · Enter read · Esc summary' : detail ? `Enter read · h ${unitTerm}s · PgDn more` : 'Choose Read or a section to continue'}</text></box>
  </box>;
  return <box flexGrow={1} minHeight={0} minWidth={0} flexDirection="row" gap={1}>
    {(wide || !detail) && <box flexGrow={1} minHeight={0} minWidth={0} backgroundColor={p.panel} border={['top']} borderColor={!detail ? p.accent : p.line}>
      <box height={2} paddingX={1} flexShrink={0}><text fg={p.accent}>THE WHOLE LIBRARY <span fg={p.muted}>· {filter ? `${matching.length} ${matching.length === 1 && bookTerm.endsWith('s') ? bookTerm.slice(0, -1) : bookTerm} found` : `${store.books.length} ${bookTerm}`}</span></text></box>
      <box flexDirection="row" gap={1} paddingX={1} height={2} flexShrink={0}>
        <Action p={p} active={testament === 'all'} onPress={() => filterTestament('all')}>All</Action>
        {!jewish && <><Action p={p} active={testament === 'OT'} onPress={() => filterTestament('OT')}>Old 39</Action>
        <Action p={p} active={testament === 'NT'} onPress={() => filterTestament('NT')}>New 27</Action></>}
        <Action p={p} onPress={findBook}>Find {rabbinic ? 'text' : 'book'} /</Action>
      </box>
      {(editing || filter) && <box height={3} marginX={1} border borderColor={editing ? p.accent : p.line} flexShrink={0} flexDirection="row">
        <input id="book-input" focused={active && editing} flexGrow={1} flexBasis={0} minWidth={0} value={filter} onInput={changeFilter} onSubmit={() => { if (matching.length) { setEditing(false); setDetail(true); } }} placeholder={rabbinic ? 'Text or tractate name' : torah ? 'Book name, e.g. Exodus' : 'Book name, e.g. John'} textColor={p.fg} backgroundColor={p.bg} focusedBackgroundColor={p.bg} focusedTextColor={p.fg} cursorColor={p.accent} />
        <Action p={p} onPress={() => { setFilter(''); setEditing(false); }}>Clear</Action>
      </box>}
      <scrollbox ref={mapRef} flexGrow={1} minHeight={0} scrollX={false} {...scrollIndicators(p)} contentOptions={{ paddingX: 1 }}>
        {!matching.length && <box paddingY={1}><text fg={p.muted}>No {bookTerm} match “{filter}”. Clear the search to browse all.</text></box>}
        {(jewish ? [...new Set(store.books.map(b => b.testament))] : ['OT', 'NT']).filter(t => matching.some(b => b.testament === t)).map(t => <box key={t} marginBottom={1}>
          <box height={2}><text fg={p.fg}><strong>{jewish ? t.toUpperCase() : t === 'OT' ? 'OLD TESTAMENT' : 'NEW TESTAMENT'}</strong></text></box>
          {bookGroups.filter(group => group.testament === t).map(group => {
            const books = matching.filter(b => b.id >= group.first && b.id <= group.last);
            return books.length > 0 && <box key={group.first} marginBottom={1}>
              {(!rabbinic || group.name !== t) && <text fg={group.color}>{group.name}</text>}
              <box flexDirection="row" flexWrap="wrap">{books.map(b => <HoverBox p={p} key={b.id} id={`library-book-${b.id}`} width={tileWidth} height={rabbinic ? 2 : 1} paddingX={1} active={bookId === b.id} backgroundColor={bookId === b.id ? p.selected : p.panel}
                onHover={inside => { if (inside) setHoverId(b.id); }} onMouseDown={() => { select(b.id); setDetail(true); }}>
                <text fg={bookId === b.id || hoverId === b.id ? p.accent : p.fg}>{rabbinic ? b.name : b.name.padEnd(16)}<span fg={p.muted}>{rabbinic ? ` · ${b.chapters}` : String(b.chapters).padStart(3)}</span></text>
              </HoverBox>)}</box>
            </box>;
          })}
        </box>)}
      </scrollbox>
      <box height={1} paddingX={1} flexShrink={0}><text fg={p.muted}>Enter overview · numbers = {unitTerm === 'daf' ? 'daf / amud' : unitTerm + 's'}</text></box>
    </box>}
    {(wide || detail) && details}
  </box>;
}
