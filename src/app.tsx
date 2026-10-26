import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useKeyboard, useRenderer, useTerminalDimensions } from '@opentui/react';
import type { ScrollBoxRenderable } from '@opentui/core';
import { BibleStore, parallelEdition, editionName, unitName, isJewishLibrary, isRabbinicLibrary, type LibraryId, type ScriptureStore, type Translation, type Verse, type Book } from './store';
import { askCodex } from './codex';
import { studyRequest, type StudyAssistant, type StudyAnswer, type StudyProgress } from './study';
import { Action, HoverBox, scrollIndicators, type Palette } from './controls';
import { Explore, type ExploreHandle, type ConnectionKind } from './explore';
import type { PassageRange } from './references';
import { HybridSearch, type BibleSearch } from './search';
import { wholeBibleRequest } from './research';
import { TorahStore } from './torah-store';
import { JewishStore, jewishLibraries, type JewishLibraryId } from './jewish-store';
import { TorahAdapter } from './torah-adapter';
import { ScriptureText, BilingualText, HebrewMarksContext } from './scripture-text';
import { hebrewRendererError, type HebrewMarks } from './hebrew';

export type Mode = 'workspace' | 'study' | 'reader' | 'atlas';
type Panel = 'results' | 'compare' | 'atlas';
const palettes: Record<Mode, Palette> = {
  workspace: { bg: '#14191b', panel: '#192023', raised: '#252e2e', fg: '#e1e1d5', muted: '#9fa9a6', line: '#35423f', accent: '#d4ba88', selected: '#35372e' },
  study: { bg: '#10151d', panel: '#151c26', raised: '#1b2634', fg: '#dce4ec', muted: '#8b9cad', line: '#304050', accent: '#94c7e8', selected: '#253b50' },
  reader: { bg: '#191816', panel: '#201e1b', raised: '#2a2722', fg: '#e4dece', muted: '#a89e8d', line: '#423b30', accent: '#d9b77c', selected: '#383126' },
  atlas: { bg: '#101a18', panel: '#15211e', raised: '#1d2e28', fg: '#deebe1', muted: '#8fa99c', line: '#30483d', accent: '#a6cf9f', selected: '#2a4938' },
};
const modes: Mode[] = ['study', 'reader', 'atlas'];
const titles = { workspace: 'WORKSPACE', study: 'STUDY DESK', reader: 'READER', atlas: 'ATLAS' };
const subtitles = { workspace: 'One passage. Open the context you need.', study: 'Follow the text. Keep the context.', reader: 'Room to read.', atlas: 'Trace a word through the whole story.' };
const number = (value: number) => value.toLocaleString('en-US');


function Label({ children, color }: { children: ReactNode; color: string }) {
  return <text fg={color}>{children}</text>;
}
function Highlight({ text, query, p }: { text: string; query: string; p: Palette }) {
  const terms = query.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (!terms.length) return <text fg={p.fg}>{text}</text>;
  const regex = new RegExp(`(${terms.join('|')})`, 'giu');
  return <text fg={p.fg}>{text.split(regex).map((part, i) => i % 2 ? <span key={i} fg={p.accent}><strong>{part}</strong></span> : part)}</text>;
}

type AppProps = { store: BibleStore; initialMode?: Mode; initialExplore?: boolean; initialLibrary?: LibraryId; torahStore?: TorahStore; assistant?: StudyAssistant; search?: BibleSearch; torahSearch?: BibleSearch; jewishStores?: Partial<Record<JewishLibraryId,JewishStore>>; jewishSearch?: BibleSearch };
export function App(props: AppProps) {
  const renderer = useRenderer();
  // Each retained workspace has several independently scrollable panels.
  useMemo(() => { if (renderer.getMaxListeners() < 128) renderer.setMaxListeners(128); }, [renderer]);
  const [library, setLibrary] = useState(props.initialLibrary ?? 'bible');
  const [torahOpened, setTorahOpened] = useState(library === 'torah');
  const [opened,setOpened]=useState<JewishLibraryId[]>(!['bible','torah'].includes(library) ? [library as JewishLibraryId] : []);
  const [picker,setPicker]=useState(false),[cursor,setCursor]=useState(0);
  const menuRef=useRef<ScrollBoxRenderable>(null);
  const choices: {id:LibraryId;name:string;detail:string}[]=[{id:'bible',name:'Bible',detail:'66 books · KJV / WEB'},{id:'torah',name:'Torah',detail:'Five books · Hebrew / JPS 1917'},...Object.entries(jewishLibraries).map(([id,info])=>({id:id as LibraryId,name:info.name,detail:id==='midrash'?'15 major collections · edition coverage varies':id==='zohar'?'Soncino English · partial coverage':`${info.bookTerm} · original / available English`}))];
  function choose(value: LibraryId) { if (value === 'torah') setTorahOpened(true); else if(value!=='bible')setOpened(ids=>ids.includes(value)?ids:[...ids,value]);setLibrary(value);setPicker(false); }
  const openLibraries=()=>{setCursor(choices.findIndex(c=>c.id===library));setPicker(true);};
  useEffect(()=>{if(!picker)return;const timer=setTimeout(()=>menuRef.current?.scrollChildIntoView('library-choice-'+cursor),40);return()=>clearTimeout(timer);},[picker,cursor]);
  useKeyboard(key => { if(key.name==='f5'){key.preventDefault();if(picker)setPicker(false);else openLibraries();return;}if(picker){key.preventDefault();if(key.name==='escape')setPicker(false);else if(key.name==='down'||key.sequence==='j')setCursor(i=>Math.min(choices.length-1,i+1));else if(key.name==='up'||key.sequence==='k')setCursor(i=>Math.max(0,i-1));else if(key.name==='return')choose(choices[cursor].id);else if(key.sequence==='q'||key.ctrl&&key.name==='c')renderer.destroy();return;}if (key.name === 'f4') { key.preventDefault(); choose(library === 'bible' ? 'torah' : 'bible'); } });
  return <box width="100%" height="100%">
    <Workspace {...props} active={!picker && library === 'bible'} onLibrary={choose} onLibraries={openLibraries} />
    {opened.map(id=><JewishLibrary key={id} {...props} library={id} active={!picker && library===id} onLibrary={choose} onLibraries={openLibraries} />)}
    {picker && <box width="100%" height="100%" padding={1} backgroundColor={palettes.workspace.bg}><box height={2} flexShrink={0} flexDirection="row" justifyContent="space-between"><text fg={palettes.workspace.accent}>CHOOSE A LIBRARY</text><Action p={palettes.workspace} onPress={()=>setPicker(false)}>Close [Esc]</Action></box><scrollbox ref={menuRef} flexGrow={1} minHeight={0} scrollX={false} {...scrollIndicators(palettes.workspace)}>{choices.map((choice,i)=><HoverBox key={choice.id} id={'library-choice-'+i} p={palettes.workspace} active={cursor===i} padding={1} backgroundColor={cursor===i?palettes.workspace.selected:palettes.workspace.panel} onMouseDown={()=>choose(choice.id)}><text fg={palettes.workspace.fg}><strong>{choice.name}{library===choice.id?' · current':''}</strong></text><text fg={palettes.workspace.muted}>{choice.detail}</text></HoverBox>)}</scrollbox><text fg={palettes.workspace.muted}>↑↓ choose · Enter open · Esc back</text></box>}
    {torahOpened && <TorahLibrary {...props} active={!picker && library === 'torah'} onLibrary={choose} onLibraries={openLibraries} />}
  </box>;
}
function TorahLibrary(props: AppProps & { active: boolean; onLibrary(value: LibraryId): void; onLibraries():void }) {
  const loaded = useMemo(() => { try { return { adapter: new TorahAdapter(props.torahStore ?? new TorahStore()), error: '' }; } catch (error) { return { adapter: null, error: (error as Error).message }; } }, [props.torahStore]);
  const renderer = useRenderer();
  useKeyboard(key => { if (props.active && !loaded.adapter && (key.sequence === 'q' || key.ctrl && key.name === 'c')) renderer.destroy(); });
  useEffect(() => () => { loaded.adapter?.close(); if (!props.torahStore) loaded.adapter?.torah.close(); }, [loaded, props.torahStore]);
  if (!loaded.adapter) return <box visible={props.active} width="100%" height="100%" padding={2}><text>{loaded.error}</text><Action p={palettes.workspace} onPress={() => props.onLibrary('bible')}>← Bible library</Action></box>;
  return <Workspace store={loaded.adapter} active={props.active} onLibrary={props.onLibrary} onLibraries={props.onLibraries} assistant={props.assistant} search={props.torahSearch} initialExplore />;
}
function JewishLibrary(props:AppProps & {library:JewishLibraryId;active:boolean;onLibrary(value:LibraryId):void;onLibraries():void}) {
  const renderer=useRenderer();
  useKeyboard(key=>{if(props.active && !loaded.store && (key.sequence==='q' || key.ctrl && key.name==='c'))renderer.destroy();});
  const loaded=useMemo(()=>{try{return {store:props.jewishStores?.[props.library]??new JewishStore(props.library),error:''};}catch(error){return {store:null,error:(error as Error).message};}},[props.library,props.jewishStores]);
  useEffect(()=>()=>{if(!props.jewishStores?.[props.library])loaded.store?.close();},[loaded]);
  if(!loaded.store)return <box visible={props.active} width="100%" height="100%" padding={2}><text>{loaded.error}</text><Action p={palettes.workspace} onPress={props.onLibraries}>Choose another library [F5]</Action></box>;
  return <Workspace store={loaded.store} active={props.active} onLibrary={props.onLibrary} onLibraries={props.onLibraries} assistant={props.assistant} search={props.jewishSearch} initialExplore />;
}
function Workspace({ store, active, onLibrary, onLibraries, initialMode = 'workspace', initialExplore = false, assistant = askCodex, search: suppliedSearch }: { store: ScriptureStore; active: boolean; onLibrary(value: LibraryId): void; onLibraries():void; initialMode?: Mode; initialExplore?: boolean; assistant?: StudyAssistant; search?: BibleSearch }) {
  const renderer = useRenderer();
  const { width, height } = useTerminalDimensions();
  const [mode, setMode] = useState<Mode>(initialMode);
  const torah = store.profile.id === 'torah';
  const jewish=isJewishLibrary(store),rabbinic=isRabbinicLibrary(store);
  const bookTerm=store.profile.bookTerm??'books',unitTerm=store.profile.unitTerm??'chapter',segmentTerm=store.profile.segmentTerm??'verses';
  const [notesOpen,setNotesOpen]=useState(false);
  const libraryName = store.profile.name;
  const otherVersion = (version: Translation) => parallelEdition(store, version);
  const [marks, setMarks] = useState<HebrewMarks>('full');
  const [parallel, setParallel] = useState(jewish && store.profile.id !== 'zohar');
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const cycleMarks = () => setMarks(value => value === 'full' ? 'vowels' : value === 'vowels' ? 'plain' : 'full');
  const [panels, setPanels] = useState({ results: true, compare: true, atlas: false });
  const [focusMode, setFocusMode] = useState(false);
  const [compactPanel, setCompactPanel] = useState<Panel | 'passage'>('passage');
  const compact = width < 110 || height < 30;
  const visible = (panel: Panel) => !focusMode && panels[panel] && (!compact || compactPanel === panel);
  const [translation, setTranslation] = useState<Translation>(store.profile.defaultEdition);
  const [location, setLocation] = useState(() => {
    if (jewish) return { book: 1, chapter: 1, verse: 1 };
    if (initialMode === 'reader') return { book: 19, chapter: 23, verse: 1 };
    if (initialMode === 'atlas') {
      const first = store.search('mercy', 'WEB').verses[0];
      if (first) return { book: first.book_id, chapter: first.chapter, verse: first.verse };
    }
    return { book: 43, chapter: 1, verse: 1 };
  });
  const [query, setQuery] = useState(jewish ? '' : initialMode === 'atlas' ? 'mercy' : initialMode === 'reader' ? '' : 'light');
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [focus, setFocus] = useState<'passage' | 'results'>('passage');
  const [filter, setFilter] = useState<number | undefined>();
  const [savedOnly, setSavedOnly] = useState(false);
  const [savedVersion, setSavedVersion] = useState(0);
  const [notice, setNotice] = useState('');
  const [help, setHelp] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [askScope, setAskScope] = useState<'bible' | 'passage'>('bible');
  const searchService = useMemo(() => suppliedSearch ?? new HybridSearch(store), [store, suppliedSearch]);
  const [exploreOpen, setExploreOpen] = useState(initialExplore);
  const [exploreSection, setExploreSection] = useState('Books');
  const [readingFromExplore, setReadingFromExplore] = useState(false);
  const exploreRef = useRef<ExploreHandle>(null);
  const [askEditing, setAskEditing] = useState(false);
  const [askDraft, setAskDraft] = useState('');
  const [askBusy, setAskBusy] = useState(false);
  const [askError, setAskError] = useState('');
  const [askAnswer, setAskAnswer] = useState<StudyAnswer | null>(null);
  const [askQuestion, setAskQuestion] = useState('');
  const [askPassage, setAskPassage] = useState('');
  const [askProgress, setAskProgress] = useState<StudyProgress>({ status: '' });
  const askController = useRef<AbortController | null>(null);
  const askRef = useRef<ScrollBoxRenderable>(null);
  const askVisible = active && mode === 'workspace' && askOpen && !focusMode;
  const exploreVisible = active && mode === 'workspace' && exploreOpen && !focusMode && !askVisible;
  const passageRef = useRef<ScrollBoxRenderable>(null);
  const resultsRef = useRef<ScrollBoxRenderable>(null);
  const p = palettes[mode];
  const book = store.book(location.book);
  const chapter = useMemo(() => store.chapter(location.book, location.chapter, translation), [store, location.book, location.chapter, translation]);
  const selected = chapter.find(v => v.verse === location.verse) ?? chapter[0];
  const search = useMemo(() => store.search(query, translation, filter), [store, query, translation, filter]);
  const saved = useMemo(() => store.saved(translation), [store, translation, savedVersion]);
  const results = savedOnly ? saved : search.verses;
  const selectedIndex = results.findIndex(v => v.book_id === location.book && v.chapter === location.chapter && v.verse === location.verse);
  const comparison = selected && store.verse(selected.book_id, selected.chapter, selected.verse, otherVersion(translation));
  const isSaved = selected && store.isSaved(selected);

  function togglePanel(panel: Panel) {
    setAskEditing(false);
    if (compact || panel === 'compare') setAskOpen(false);
    if (compact || panel !== 'atlas') setExploreOpen(false);
    const next = (panel === 'compare' && askVisible) || (panel !== 'atlas' && exploreVisible) ? true : !visible(panel);
    setFocusMode(false);
    setPanels(current => ({ ...current, [panel]: next }));
    if (compact) setCompactPanel(next ? panel : 'passage');
    if (panel === 'results') setFocus(next ? 'results' : 'passage');
  }
  function toggleFocus() { setFocusMode(current => !current); setAskEditing(false); setFocus('passage'); }
  function preset(key: string) {
    setMode('workspace');
    setFocus('passage');
    setAskEditing(false);
    if (key === '2') { setFocusMode(true); return; }
    setAskOpen(false);
    setExploreOpen(false);
    setFocusMode(false);
    setPanels({ results: true, compare: true, atlas: key === '3' });
    setCompactPanel(key === '3' && compact ? 'atlas' : 'passage');
  }
  function showResults(keepExplore = false) {
    if (!keepExplore) setExploreOpen(false);
    setAskEditing(false); if (compact) setAskOpen(false);
    setFocus('results');
    if (mode === 'workspace') { setPanels(current => ({ ...current, results: true })); setFocusMode(false); setCompactPanel('results'); }
  }
  function showSaved() { setSavedOnly(current => !current); showResults(); }

  function go(v: Verse, read = false) {
    setAskEditing(false);
    if(v.translation!==translation)setTranslation(v.translation);
    setLocation({ book: v.book_id, chapter: v.chapter, verse: v.verse });
    if (read) { setFocus('passage'); setCompactPanel('passage'); }
    setNotice('');
  }
  function submit(value: string) {
    const term = value.trim();
    if (!term) { setQuery(''); setFilter(undefined); setSavedOnly(false); setEditing(false); return; }
    try {
      const ref = store.parseReference(term);
      if (ref) {
        const verse = store.verse(ref.book.id, ref.chapter, ref.verse, translation);
        const end = ref.end && store.verse(ref.book.id, ref.chapter, ref.end, translation);
        if ((!verse && !rabbinic) || (ref.end && !end && !rabbinic)) throw new Error(`That verse is not present in ${translation}.`);
        go(verse ?? store.chapter(ref.book.id,ref.chapter,translation).find(v=>v.verse===ref.verse)!, true);
        if (exploreVisible && exploreSection.toLowerCase() === bookTerm.toLowerCase()) { setExploreOpen(false); setFocusMode(true); setReadingFromExplore(true); }
        setQuery(''); setFilter(undefined); setSavedOnly(false);
      } else {
        const version:Translation = jewish ? /[\u0590-\u05ff]/u.test(term) ? torah ? 'hebrew' : 'original' : torah ? 'jps1917' : 'english' : translation;
        setTranslation(version);
        setQuery(term); setFilter(undefined); setSavedOnly(false); showResults();
        const found = store.search(term, version);
        if (found.verses[0]) go(found.verses[0]);
        setNotice(found.total ? '' : 'No matches. Try a shorter word or a different translation.');
      }
      setEditing(false);
    } catch (error) { setNotice((error as Error).message); }
  }
  function changeChapter(delta: number) {
    let id = location.book, ch = location.chapter + delta;
    if (ch < 1) { id--; if (id < 1) return; ch = store.book(id).chapters; }
    if (ch > store.book(id).chapters) { id++; if (id > store.books.length) return; ch = 1; }
    const first = store.chapter(id, ch, translation)[0];
    if (first) go(first, true);
  }
  function move(delta: number) {
    if (!exploreVisible && focus === 'results' && results.length) {
      const i = selectedIndex < 0 ? (delta > 0 ? 0 : results.length - 1) : Math.max(0, Math.min(results.length - 1, selectedIndex + delta));
      go(results[i]);
    } else {
      const index = chapter.findIndex(v => v.id === selected?.id);
      const v = chapter[index + delta];
      if (v) go(v); else changeChapter(delta);
    }
  }
  function bookmark() {
    if (!selected) return;
    store.toggleSaved(selected); setSavedVersion(v => v + 1);
    setNotice(store.isSaved(selected) ? `Saved ${store.label(selected)}` : `Removed ${store.label(selected)} from saved passages`);
  }
  function copyVerse() {
    if (!selected) return;
    const text = [store.label(selected), selected.text, jewish && parallel ? comparison?.text : ''].filter(Boolean).join('\n');
    setNotice(renderer.copyToClipboardOSC52(text) ? 'Verse copied in its original text order' : 'Your terminal did not accept clipboard copying');
  }
  function switchVersion() {
    const next = otherVersion(translation);
    const verses = store.chapter(location.book, location.chapter, next);
    const target = verses.find(v => v.verse === location.verse) ?? verses.find(v => v.verse > location.verse) ?? verses.at(-1);
    setTranslation(next);
    if (target) {
      setLocation({ book: target.book_id, chapter: target.chapter, verse: target.verse });
      setNotice(target.verse === location.verse ? '' : `Verse ${location.verse} is absent in ${next}; showing verse ${target.verse}.`);
    }
  }
  function chooseBook(b: Book) {
    if (query) {
      setFilter(b.id); setSavedOnly(false); showResults(true);
      const first = store.search(query, translation, b.id).verses[0];
      if (first) go(first);
    } else { const first = store.chapter(b.id, 1, translation)[0]; if (first) go(first, true); }
  }
  function beginSearch() { setDraft(''); setEditing(true); setAskEditing(false); setHelp(false); setNotice(''); }
  function toggleAsk() {
    const next = !askVisible;
    setAskOpen(next); setAskEditing(next); setFocusMode(false); setEditing(false); setHelp(false);
  }
  function toggleExplore() {
    setExploreOpen(!exploreVisible); setAskOpen(false); setAskEditing(false); setFocusMode(false); setEditing(false); setHelp(false);
  }
  function showReader() {
    if (exploreVisible) setReadingFromExplore(true);
    setExploreOpen(false); setAskOpen(false); setAskEditing(false); setEditing(false); setHelp(false); setFocusMode(true); setFocus('passage');
  }
  function backToExplore() {
    setExploreOpen(true); setAskOpen(false); setAskEditing(false); setEditing(false); setHelp(false); setFocusMode(false);
  }
  function explainConnection(range: PassageRange, from: PassageRange, kind: ConnectionKind) {
    setAskOpen(true); setAskEditing(false); setFocusMode(false); setEditing(false); setHelp(false);
    setAskScope('passage');
    const extras = [...store.passage(from, translation).verses, ...store.passage(range, translation).verses];
    const relationship = kind === 'Cross-reference'
      ? `${store.profile.linksSource} lists ${store.rangeLabel(from)} and ${store.rangeLabel(range)} as connected passages. This link is an editorial study aid, not proof of identical meanings.`
      : `${store.rangeLabel(range)} is adjacent chapter context for ${store.rangeLabel(from)}.`;
    void runAsk(`${relationship} Explain their possible connection using the supplied text, and identify any meaningful differences.`, extras, 'passage');
  }
  function askTopic(question: string) {
    setAskOpen(true); setAskEditing(false); setFocusMode(false); setEditing(false); setHelp(false); setAskScope('bible');
    setAskDraft(question); void runAsk(question, [], 'bible');
  }
  function chooseAskScope(scope: 'bible' | 'passage') {
    if (askBusy) return;
    setAskScope(scope); setAskQuestion(''); setAskAnswer(null); setAskError(''); setAskProgress({ status: '' });
  }
  function stopAsk() {
    askController.current?.abort(); askController.current = null;
    setAskBusy(false); setAskProgress(current => ({ ...current, status: 'Stopped.' }));
  }
  async function runAsk(question = askDraft, extraVerses: Verse[] = [], scope = askScope) {
    if (!selected || !question.trim() || askBusy) return;
    const controller = new AbortController(); askController.current = controller;
    setAskBusy(true); setAskEditing(false); setAskError(''); setAskAnswer(null);
    setAskQuestion(question.trim()); setAskPassage(scope === 'bible' ? `Whole ${libraryName} · ${editionName(translation)}` : `${store.label(selected)} · ${translation}`);
    setAskProgress({ status: scope === 'bible' ? `Searching the whole ${libraryName} locally…` : 'Connecting to your Codex subscription…' });
    askRef.current?.scrollTo(0);
    try {
      const progressUpdate = (progress: StudyProgress) => {
        if (!controller.signal.aborted) setAskProgress(progress);
      };
      const request = scope === 'bible'
        ? await wholeBibleRequest(store, searchService, question, translation, controller.signal, progressUpdate)
        : studyRequest(store, selected, question, query, extraVerses);
      controller.signal.throwIfAborted();
      const answer = await assistant(request, controller.signal, progressUpdate);
      if (!controller.signal.aborted) { setAskAnswer(answer); setAskProgress({ status: 'Answer ready', model: answer.model, plan: answer.plan }); }
    } catch (error) {
      if (!controller.signal.aborted) { setAskError((error as Error).message); setAskProgress(current => ({ ...current, status: 'Could not answer' })); }
    } finally {
      if (askController.current === controller) { askController.current = null; setAskBusy(false); }
    }
  }
  useEffect(() => () => { askController.current?.abort(); }, []);
  useEffect(() => () => { if (!suppliedSearch) searchService.close?.(); }, [searchService, suppliedSearch]);

  useEffect(() => {
    const handle = setTimeout(() => {
      passageRef.current?.scrollChildIntoView(`verse-${selected?.verse}`);
      resultsRef.current?.scrollChildIntoView(`hit-${selected?.id}`);
    }, 30);
    return () => clearTimeout(handle);
  }, [selected?.id, mode, width, focus, focusMode, compactPanel, panels.results, panels.compare, panels.atlas, exploreVisible]);

  useKeyboard(key => {
    if (!active) return;
    if (key.ctrl && key.name === 'c') { renderer.destroy(); return; }

    if (mode === 'workspace' && ['f1', 'f2', 'f3'].includes(key.name)) { key.preventDefault(); setEditing(false); preset(key.name.slice(1)); return; }
    if (editing) {
      if (key.name === 'escape') { setEditing(false); setNotice(''); key.preventDefault(); }
      return;
    }
    if (askVisible && askEditing) {
      if (key.name === 'escape') { key.preventDefault(); setAskEditing(false); }
      return;
    }
    if (askVisible && key.name === 'escape') { key.preventDefault(); if (askBusy) stopAsk(); else setAskOpen(false); return; }
    if (help) { if (key.name === 'escape' || key.sequence === '?') setHelp(false); return; }
    if (sourcesOpen) { if (key.name === 'escape' || key.name === 'backspace') setSourcesOpen(false); else if (key.sequence === 'q') renderer.destroy(); return; }
    if (exploreVisible) {
      const handled = exploreRef.current?.key(key);
      if (handled) { if (handled !== 'input') key.preventDefault(); return; }
    }
    if (exploreVisible && key.name === 'escape') { setExploreOpen(false); key.preventDefault(); return; }
    const keyName = key.sequence || key.name;
    if (keyName === '/' || (key.ctrl && key.name === 'f')) { key.preventDefault(); beginSearch(); }
    else if (['1', '2', '3'].includes(keyName)) { if (mode === 'workspace') preset(keyName); else setMode(modes[Number(keyName) - 1]); }
    else if (keyName === '0') setMode('workspace');
    else if (mode === 'workspace' && keyName === 'x') toggleExplore();
    else if (mode === 'workspace' && !exploreVisible && !askVisible && readingFromExplore && key.name === 'backspace') { key.preventDefault(); backToExplore(); }
    else if (mode === 'workspace' && keyName === 'i') { key.preventDefault(); toggleAsk(); }
    else if (askVisible && keyName === 'e' && !askBusy) { key.preventDefault(); setAskEditing(true); }
    else if (askVisible && keyName === 'w') chooseAskScope('bible');
    else if (askVisible && keyName === 'p') chooseAskScope('passage');
    else if (mode === 'workspace' && keyName === 'a') togglePanel('atlas');
    else if (mode === 'workspace' && keyName === 'r') togglePanel('results');
    else if (mode === 'workspace' && keyName === 'c') togglePanel('compare');
    else if (mode === 'workspace' && keyName === 'f') toggleFocus();
    else if (key.name === 'tab') { key.preventDefault(); if (focus === 'passage') showResults(); else { setFocus('passage'); setCompactPanel('passage'); } }
    else if (key.name === 'down' || keyName === 'j') { key.preventDefault(); move(1); }
    else if (key.name === 'up' || keyName === 'k') { key.preventDefault(); move(-1); }
    else if (key.name === 'return') { setFocus('passage'); setCompactPanel('passage'); if (mode === 'atlas') setMode('reader'); }
    else if (jewish && keyName === 'm') cycleMarks();
    else if (jewish && keyName === 'd') setParallel(value => !value);
    else if (rabbinic && keyName === 'n') setNotesOpen(value=>!value);
    else if (keyName === 'y' && selected) copyVerse();
    else if (keyName === 'v') switchVersion();
    else if (keyName === 'b') bookmark();
    else if (keyName === 's') showSaved();
    else if (keyName === '[' || key.name === 'left') changeChapter(-1);
    else if (keyName === ']' || key.name === 'right') changeChapter(1);
    else if (keyName === '?') setHelp(true);
    else if (keyName === 'q') renderer.destroy();
    else if (key.name === 'escape') { setFilter(undefined); setSavedOnly(false); setNotice(''); }
    else if (key.name === 'pagedown') { key.preventDefault(); (askVisible ? askRef : !exploreVisible && focus === 'results' ? resultsRef : passageRef).current?.scrollBy(Math.max(4, height - 14)); }
    else if (key.name === 'pageup') { key.preventDefault(); (askVisible ? askRef : !exploreVisible && focus === 'results' ? resultsRef : passageRef).current?.scrollBy(-Math.max(4, height - 14)); }
  });

  const panelTitle = (name: string, info?: string) => <box flexDirection="row" justifyContent="space-between" paddingX={1} height={2} flexShrink={0}><text fg={p.accent}>{name}</text>{info && <text fg={p.muted}>{info}</text>}</box>;
  const resultList = <box flexGrow={1} minHeight={0} backgroundColor={p.panel} border={['top']} borderColor={focus === 'results' ? p.accent : p.line} onMouseDown={() => setFocus('results')}>
    {panelTitle(savedOnly ? 'SAVED PASSAGES' : query ? 'SEARCH RESULTS' : 'LIBRARY', savedOnly ? `${saved.length}` : query ? number(search.total) : `${store.books.length} ${bookTerm}`)}
    {filter && <HoverBox p={p} height={2} paddingX={1} onMouseDown={() => setFilter(undefined)}><text fg={p.accent}>{store.book(filter).name}  × clear</text></HoverBox>}
    <scrollbox ref={resultsRef} flexGrow={1} scrollX={false} scrollbarOptions={{ visible: false }}>
      {!query && !savedOnly ? store.books.map(b => <HoverBox p={p} active={location.book === b.id} key={b.id} paddingX={1} height={2} backgroundColor={location.book === b.id ? p.selected : p.panel} onMouseDown={() => chooseBook(b)}><text fg={location.book === b.id ? p.accent : p.fg}>{b.name}</text></HoverBox>) : results.length ? results.map(v => <HoverBox p={p} active={selected?.id === v.id} key={v.id} id={`hit-${v.id}`} paddingX={1} paddingBottom={1} backgroundColor={selected?.id === v.id ? p.selected : p.panel} onMouseDown={() => go(v)}>
        <text fg={selected?.id === v.id ? p.accent : p.fg}><strong>{store.label(v)}</strong></text>
        <ScriptureText fg={p.muted} maxHeight={2} text={v.text} translation={v.translation} />
      </HoverBox>) : <box padding={1}><text fg={p.muted}>{savedOnly ? 'Your saved passages will appear here. Press b on a verse.' : 'No matching verses. Press / to try another search.'}</text></box>}
      {query && search.total > 400 && <box padding={1}><text fg={p.muted}>Showing the first 400. Select a book in Atlas to narrow the search.</text></box>}
    </scrollbox>
  </box>;

  const passage = (quiet = false) => <box flexGrow={1} minWidth={0} minHeight={0} backgroundColor={quiet ? p.bg : p.panel} onMouseDown={() => setFocus('passage')}>
    <box paddingX={quiet ? 3 : 2} paddingTop={height < 26 ? 0 : 1} flexShrink={0}>
      {height >= 26 && <text fg={p.muted}>{jewish ? libraryName.toUpperCase() : book.testament === 'OT' ? 'OLD TESTAMENT' : 'NEW TESTAMENT'}  /  {editionName(translation)}</text>}
      <box height={height < 26 ? 2 : 3} paddingTop={height < 26 ? 0 : 1}><text fg={p.fg}><strong>{book.name.toUpperCase()}  {unitName(store,location.book,location.chapter)}</strong></text></box>
      <box flexDirection="row" gap={1} paddingBottom={height < 26 ? 0 : 1}>
        <Action p={p} onPress={() => changeChapter(-1)}>← previous</Action>
        <Action p={p} onPress={() => changeChapter(1)}>next →</Action>
        <Action p={p} onPress={bookmark} active={!!isSaved}>{isSaved ? '◆ saved' : '◇ save'}</Action><Action p={p} onPress={copyVerse}>y Copy</Action>{rabbinic && <Action p={p} active={notesOpen} disabled={!selected?.notes && !comparison?.notes} onPress={()=>setNotesOpen(v=>!v)}>n Notes</Action>}
      </box>
    </box>
    {jewish && <box flexDirection="row" gap={1} paddingX={2} height={2} flexShrink={0}><Action p={p} active={(translation === 'hebrew'||translation==='original') && !parallel} onPress={() => { setTranslation(torah?'hebrew':'original'); setParallel(false); }}>{torah?'Hebrew':'Original'}</Action><Action p={p} active={(translation === 'jps1917'||translation==='english') && !parallel} onPress={() => { setTranslation(torah?'jps1917':'english'); setParallel(false); }}>English</Action><Action p={p} active={parallel} onPress={() => setParallel(value => !value)}>Parallel</Action><Action p={p} onPress={cycleMarks}>m {marks === 'full' ? 'All marks' : marks === 'vowels' ? 'Vowels' : 'Plain'}</Action></box>}
    <scrollbox ref={passageRef} flexGrow={1} minHeight={0} scrollX={false} scrollbarOptions={{ visible: false }} contentOptions={{ paddingX: quiet ? 3 : 2 }}>
      {chapter.map(v => <HoverBox p={p} active={v.id === selected?.id} id={`verse-${v.verse}`} key={v.id} paddingY={quiet && height >= 26 ? 1 : 0} paddingBottom={height < 26 ? 0 : 1} paddingX={1} flexDirection="row" backgroundColor={v.id === selected?.id ? p.selected : quiet ? p.bg : p.panel} onMouseDown={() => go(v, true)}>
        <box width={4} flexShrink={0}><text fg={v.id === selected?.id ? p.accent : p.muted}>{String(v.verse).padStart(2, '0')}</text></box>
        <box flexGrow={1} minWidth={0}>{jewish ? parallel ? <BilingualText english={store.verse(v.book_id,v.chapter,v.verse,torah?'jps1917':'english')?.text ?? 'English is unavailable for this segment.'} hebrew={store.verse(v.book_id,v.chapter,v.verse,torah?'hebrew':'original')?.text ?? 'Original text is unavailable in the installed edition.'} fg={p.fg} muted={p.muted} englishLabel={torah?'JPS 1917':'English'} originalLabel={torah?'Hebrew':'Hebrew / Aramaic'} /> : <ScriptureText text={v.text || 'This segment is unavailable in this edition. Choose the other language.'} translation={v.translation} fg={p.fg} /> : <Highlight text={v.text} query={quiet ? '' : query} p={p} />}{rabbinic && notesOpen && v.verse===selected?.verse && (v.notes||comparison?.notes) && <box marginTop={1}><text fg={p.accent}>EDITION NOTES · {editionName(v.notes ? v.translation : comparison!.translation)}</text><ScriptureText text={v.notes||comparison?.notes||''} fg={p.muted} /></box>}</box>
      </HoverBox>)}
    </scrollbox>
    <box height={height < 26 ? 1 : 2} paddingX={quiet ? 3 : 2} paddingTop={height < 26 ? 0 : 1} flexShrink={0}><text fg={p.muted}>{unitTerm.charAt(0).toUpperCase()+unitTerm.slice(1)} {unitName(store,location.book,location.chapter)}  ·  {chapter.length} {segmentTerm}</text></box>
  </box>;

  const inspector = <box width={mode === 'workspace' && compact ? '100%' : 32} minHeight={0} backgroundColor={p.panel} border={['left']} borderColor={p.line}>
    <scrollbox flexGrow={1} minHeight={0} scrollX={false} contentOptions={{ paddingX: 2, paddingTop: 1 }} scrollbarOptions={{ visible: false }}>
    <Label color={p.accent}>PARALLEL TEXT</Label>
    <box marginTop={1}><text fg={p.muted}>{editionName(otherVersion(translation))} · {selected ? store.label(selected) : ''}</text></box>
    <box marginTop={1}><ScriptureText fg={p.fg} translation={otherVersion(translation)} text={comparison?.text ?? 'This verse is not present in this translation.'} /></box>
    <box marginTop={2} border={['top']} borderColor={p.line} paddingTop={1}><text fg={p.accent}>IN THIS {unitTerm.toUpperCase()}</text></box>
    <box marginTop={1}><text fg={p.muted}>Read the surrounding passage</text></box>
    {chapter.filter(v => v.verse !== selected?.verse && Math.abs(v.verse - (selected?.verse ?? 1)) <= 2).map(v => <HoverBox p={p} key={v.id} marginTop={1} onMouseDown={() => go(v, true)}><text fg={p.accent}>{store.label(v)} ↗</text><ScriptureText fg={p.muted} maxHeight={3} text={v.text} translation={v.translation} /></HoverBox>)}
    </scrollbox>
    <box paddingX={2} height={2} flexShrink={0}><text fg={p.muted}>b save   v version</text></box>
  </box>;

  const mapBook = (b: Book, dense = false) => {
    const count = search.counts.get(b.id) ?? 0;
    const max = Math.max(1, ...search.counts.values());
    const level = !count ? 0 : Math.ceil(Math.sqrt(count / max) * 4);
    const shades = [p.panel, '#203b2c', '#2e543b', '#42724a', '#61935a'];
    return <HoverBox p={p} key={b.id} width={9} height={1} paddingX={1} marginRight={1} marginBottom={dense ? 0 : 1} backgroundColor={filter === b.id ? p.accent : shades[level]} hoverBackground={p.fg} onMouseDown={() => chooseBook(b)}>
      {hovered => <text fg={hovered || filter === b.id || level === 4 ? '#101a18' : count ? p.fg : p.muted}>{b.osis.slice(0, 3).padEnd(3)}{count ? String(count).padStart(4) : '   ·'}</text>}
    </HoverBox>;
  };
  const atlasMap = <box flexGrow={1} minWidth={0} minHeight={0} backgroundColor={p.panel} paddingX={2} paddingTop={1}>
    <text fg={p.accent}>THE CANON, AT A GLANCE</text>
    <box height={3} paddingTop={1}><text fg={p.fg}>{query ? `“${query}” · ${number([...search.counts.values()].reduce((a, b) => a + b, 0))} matching verses` : 'Choose a book, or press / to trace a word.'}</text></box>
    <scrollbox flexGrow={1} minHeight={0} scrollX={false} scrollbarOptions={{ visible: false }}>
      <text fg={p.muted}>{jewish ? libraryName.toUpperCase() : 'OLD TESTAMENT'}</text>
      <box marginTop={1} flexDirection="row" flexWrap="wrap">{store.books.filter(b => jewish || b.testament === 'OT').map(b => mapBook(b))}</box>
      {!jewish && <box marginTop={1}><text fg={p.muted}>NEW TESTAMENT</text></box>}
      <box marginTop={1} flexDirection="row" flexWrap="wrap">{store.books.filter(b => b.testament === 'NT').map(b => mapBook(b))}</box>
      <box marginTop={1} paddingBottom={1}><text fg={p.muted}>Darker = fewer matches · brighter = more</text><text fg={p.muted}>Counts are matching verses, not word occurrences.</text></box>
    </scrollbox>
  </box>;

  const atlasDrawer = <box height={exploreVisible ? Math.min(14, Math.max(7, height - 30)) : 14} flexShrink={0} border={['top']} borderColor={p.line} backgroundColor={p.panel} paddingX={2}>
    <box height={2} flexShrink={0} flexDirection="row" justifyContent="space-between">
      <text fg={p.accent}><strong>ATLAS</strong><span fg={p.muted}>{query ? `  / “${query}” · ${number([...search.counts.values()].reduce((a, b) => a + b, 0))} matching verses` : '  / choose a book'}</span></text>
      <Action p={p} onPress={() => togglePanel('atlas')}>a close ×</Action>
    </box>
    <scrollbox flexGrow={1} minHeight={0} scrollX={false} scrollbarOptions={{ visible: false }}>
      {(jewish ? [...new Set(store.books.map(b=>b.testament))] : ['OT', 'NT']).map(testament => <box key={testament} flexDirection="row" marginBottom={1}>
        <box width={5} flexShrink={0}><text fg={p.muted}>{testament}</text></box>
        <box flexGrow={1} minWidth={0} flexDirection="row" flexWrap="wrap">{store.books.filter(b => b.testament === testament).map(b => mapBook(b, true))}</box>
      </box>)}
    </scrollbox>
    <box height={1} flexShrink={0} flexDirection="row" justifyContent="space-between"><text fg={p.muted}>Click a book to filter · brighter = more matching verses</text>{filter && <Action p={p} onPress={() => setFilter(undefined)}>Clear {store.book(filter).name} ×</Action>}</box>
  </box>;

  const askPanel = <box width={compact ? '100%' : askScope === 'bible' ? 56 : 44} minHeight={0} backgroundColor={p.panel} border={['left']} borderColor={p.line}>
    <box height={height < 24 ? 1 : 2} flexShrink={0} paddingX={1} flexDirection="row" justifyContent="space-between">
      <text fg={p.accent}><strong>ASK SCRIPTURE</strong></text>
      <Action p={p} onPress={() => { setAskOpen(false); setAskEditing(false); }}>{exploreOpen ? `← ${exploreSection}` : '× close'}</Action>
    </box>
    <box height={compact ? 1 : 2} paddingX={1} flexShrink={0} flexDirection="row" gap={1}><Action p={p} active={askScope === 'bible'} disabled={askBusy} onPress={() => chooseAskScope('bible')}>w Whole {libraryName}</Action><Action p={p} active={askScope === 'passage'} disabled={askBusy} onPress={() => chooseAskScope('passage')}>p This passage</Action></box>
    <scrollbox ref={askRef} flexGrow={1} minHeight={0} scrollX={false} contentOptions={{ paddingX: 2 }} {...scrollIndicators(p)}>
      {(!compact || !askAnswer) && <text fg={p.muted}>{askProgress.model ? `${askProgress.model}\nChatGPT subscription · shared limits` : 'Your Codex subscription\nShares your Codex usage limits'}</text>}
      {!askQuestion && <box marginTop={1}>
        <text fg={p.fg}>{askScope === 'bible' ? `Ask a ${libraryName} question without choosing a verse. Search gathers relevant passages; the agent can search further and read context.` : 'Explore a verse with its surrounding chapter and parallel translation.'}</text>
        <box marginTop={1}><text fg={p.muted}>Your question and retrieved {libraryName} text are sent to Codex when you ask.</text></box>
        {askScope === 'bible' ? <>
          <box marginTop={2}><Action p={p} onPress={() => askTopic(torah ? 'How does the Torah describe caring for strangers?' : rabbinic ? `How does ${libraryName} discuss Sabbath rest?` : 'What does the Bible say about anxiety and finding peace?')}>{torah ? 'Caring for strangers' : rabbinic ? 'Sabbath rest' : 'Anxiety and peace'} ↗</Action></box>
          <box marginTop={1}><Action p={p} onPress={() => askTopic(`How does the ${libraryName} describe forgiveness?`)}>Understanding forgiveness ↗</Action></box>
        </> : <>
          <box marginTop={2}><Action p={p} onPress={() => { void runAsk('Explain the selected passage in its surrounding context.', [], 'passage'); }}>Explain this passage ↗</Action></box>
          <box marginTop={1}><Action p={p} onPress={() => { void runAsk('Compare the wording of the selected verse in the two supplied translations.', [], 'passage'); }}>Compare translations ↗</Action></box>
        </>}
      </box>}
      {askQuestion && (!compact || !askAnswer) && <box marginTop={1}>
        <text fg={p.accent}>{askPassage}</text>
        <box marginTop={1}><text fg={p.fg}><strong>{askQuestion}</strong></text></box>
      </box>}
      {askBusy && <box marginTop={1}><text fg={p.accent}>{askProgress.status}</text><box marginTop={1}><Action p={p} onPress={stopAsk}>Stop  [Esc]</Action></box></box>}
      {askError && <box marginTop={1}><text fg={p.accent}>{askError}</text><box marginTop={1}><Action p={p} onPress={() => { void runAsk(askQuestion); }}>Retry ↗</Action></box></box>}
      {!askBusy && !askAnswer && !askError && askQuestion && <box marginTop={1}><text fg={p.muted}>{askProgress.status}</text></box>}
      {askAnswer && <box marginTop={compact ? 0 : 1}>
        {compact && <text fg={p.muted} maxHeight={1}>{askQuestion}</text>}
        {askAnswer.insufficientEvidence && <box marginBottom={1}><text fg={p.accent}>The retrieved text is insufficient for a supported answer.</text></box>}
        <ScriptureText fg={p.fg} text={askAnswer.answer.replace(/\*\*(.*?)\*\*/g, '$1')} />
        {!!askAnswer.sources.length && <box marginTop={2}><text fg={p.accent}>{rabbinic ? 'PASSAGE' : 'VERSE'} SOURCES · click to read</text></box>}
        {askAnswer.sources.map(source => <HoverBox p={p} key={source.id} marginTop={1} onMouseDown={() => {
          setTranslation(source.verse.translation); go(source.verse, true); setAskEditing(false); setExploreOpen(false); if (compact) setAskOpen(false);
        }}><text fg={p.accent}>[{source.id}] {source.label} ↗</text></HoverBox>)}
        {!!askAnswer.searches?.length && <box marginTop={1}><text fg={p.accent}>SEARCHES USED</text>{askAnswer.searches.map((search, index) => <box key={index} marginTop={1}><text fg={p.muted}>{search.query} · {search.mode}</text>{search.notice && <text fg={p.muted}>{search.notice}</text>}</box>)}</box>}
        <box marginTop={1} paddingBottom={1}><text fg={p.muted}>AI explanation · check the cited text. Each question starts a fresh investigation.</text></box>
      </box>}
    </scrollbox>
    <box height={1} paddingX={1} flexShrink={0}><text fg={p.muted}>{askBusy ? askProgress.status : askScope === 'bible' ? `Search all ${store.books.length} ${bookTerm} · ${editionName(translation)}` : selected ? `Ask about ${store.label(selected)} · ${translation}` : ''}</text></box>
    <HoverBox p={p} disabled={askBusy} hoverBackground={p.panel} hoverBorder={p.accent} height={3} flexShrink={0} flexDirection="row" gap={1} marginX={1} border borderColor={askEditing ? p.accent : p.line} paddingX={1} onMouseDown={() => { if (!askBusy) { setEditing(false); setAskEditing(true); } }}>
      {askEditing && !askBusy ? <input id="ask-input" flexGrow={1} flexBasis={0} minWidth={0} focused={askVisible && !help} value={askDraft} onInput={setAskDraft} onSubmit={() => { void runAsk(); }} placeholder={askScope === 'bible' ? `Ask anything about the ${libraryName}…` : 'Ask about this passage…'} textColor={p.fg} backgroundColor={p.panel} focusedBackgroundColor={p.panel} focusedTextColor={p.fg} cursorColor={p.accent} /> : <text flexGrow={1} flexBasis={0} minWidth={0} maxHeight={1} fg={p.muted}>{askBusy ? 'Working on your question…' : askDraft || 'Type your next question…'}</text>}
      <Action p={p} primary disabled={!askBusy && !askDraft.trim()} onPress={() => { if (askBusy) stopAsk(); else void runAsk(); }}>{askBusy ? 'Stop' : 'Ask'}</Action>
    </HoverBox>
    <box height={1} paddingX={1} flexShrink={0}><text fg={p.muted}>{askBusy ? 'Esc stop · PgUp/PgDn scroll' : askEditing ? 'Enter ask · Esc return to navigation' : 'e edit question · Esc close · PgUp/PgDn'}</text></box>
  </box>;

  const workspace = <box flexGrow={1} minWidth={0} minHeight={0} gap={1}>
    {selected && <Explore ref={exploreRef} active={exploreVisible} inputActive={!editing && !help && !sourcesOpen} store={store} search={searchService} selected={selected} translation={translation} p={p} width={width} height={height} reader={passage()} onNavigate={verse => go(verse, true)} onRead={verse => { go(verse, true); setExploreOpen(false); setFocusMode(true); setReadingFromExplore(true); }} onClose={() => setExploreOpen(false)} onExplain={explainConnection} onAsk={askTopic} onViewChange={setExploreSection} />}
    {!exploreVisible && (compact && askVisible ? askPanel :
      compact && !focusMode && compactPanel === 'atlas' && panels.atlas ? atlasMap :
      compact && !focusMode && compactPanel === 'compare' && panels.compare ? inspector :
      compact && !focusMode && compactPanel === 'results' && panels.results ? resultList :
      <box flexGrow={1} minHeight={0} flexDirection="row" gap={1}>
        {!compact && visible('results') && <box width={29} minHeight={0}>{resultList}</box>}
        <box flexGrow={1} minWidth={0} minHeight={0} alignItems="center"><box width={focusMode || (!panels.results && !panels.compare && !askVisible) ? Math.min(82, width - 4) : '100%'} height="100%" minHeight={0}>{passage(focusMode || (!panels.results && !panels.compare && !askVisible))}</box></box>
        {!compact && (askVisible ? askPanel : visible('compare') && inspector)}
      </box>)}
    {!compact && visible('atlas') && atlasDrawer}
  </box>;

  if (width < 60 || height < 18) return <box visible={active} width="100%" height="100%" padding={1} backgroundColor={p.bg}><text fg={p.fg}>SCRIPTURE / {titles[mode]}</text><text fg={p.muted}>Expand to at least 60 columns × 18 rows.</text><text fg={p.accent}>Current size: {width} × {height} · q quit</text></box>;

  return <HebrewMarksContext.Provider value={marks}><box visible={active} width="100%" height="100%" backgroundColor={p.bg}>
    <box width="100%" height="100%" backgroundColor={p.bg} flexDirection="column">
    <box height={3} flexShrink={0} paddingX={2} paddingY={1} flexDirection="row" justifyContent="space-between" backgroundColor={p.panel}>
      <box flexDirection="row" gap={1}>{width >= 120 && <text fg={p.fg}><strong>{width < 100 ? 'SCRIPTURE' : 'S C R I P T U R E'}</strong>{width >= 125 && <span fg={p.muted}> / {mode === 'workspace' ? exploreVisible ? 'EXPLORE' : askVisible ? 'ASK' : 'READ' : titles[mode]}</span>}</text>}<Action p={p} active={store.profile.id==='bible'} onPress={() => onLibrary('bible')}>Bible</Action><Action p={p} active={torah} onPress={() => onLibrary('torah')}>Torah</Action><Action p={p} active={rabbinic} onPress={onLibraries}>{rabbinic?store.profile.shortName:'More'} ▾</Action></box>
      {mode === 'workspace' ? <box flexDirection="row" gap={1}>
        <Action p={p} active={!exploreVisible && !askVisible} onPress={showReader}>Read</Action>
        <Action p={p} active={exploreVisible} onPress={() => { if (!exploreVisible) backToExplore(); }}>{width < 70 && rabbinic ? 'Explore' : 'Explore [x]'}</Action>
        <Action p={p} active={askVisible} onPress={() => { if (!askVisible) toggleAsk(); }}>{width < 70 && rabbinic ? 'Ask' : 'Ask [i]'}</Action>
      </box> : <box flexDirection="row" gap={1}>{modes.map((m, i) => <Action p={p} active={mode === m} key={m} onPress={() => setMode(m)}>{i + 1} {m === 'study' ? 'Study' : m === 'reader' ? 'Reader' : 'Atlas'}</Action>)}</box>}
    </box>
    {!((exploreVisible || compact && askVisible || mode === 'workspace' && focusMode) && !editing) && <HoverBox p={p} backgroundColor={p.bg} hoverBackground={p.bg} hoverBorder={p.accent} height={3} marginX={2} marginTop={1} border borderColor={editing ? p.accent : p.line} paddingX={1} flexShrink={0} flexDirection="row" onMouseDown={() => { if (!editing) beginSearch(); }}>
      <text fg={p.accent}>{editing ? '› ' : '/ '}</text>
      {editing ? <input id="search-input" flexGrow={1} focused={active} value={draft} onInput={setDraft} onSubmit={() => submit(draft)} placeholder={rabbinic ? store.label(store.chapter(1,1,translation)[0]) : torah ? 'Shemot 3:14, covenant, or בראשית' : 'John 3:16, mercy, or "kingdom of God"'} textColor={p.fg} backgroundColor={p.bg} focusedBackgroundColor={p.bg} focusedTextColor={p.fg} cursorColor={p.accent} /> : <text fg={query ? p.fg : p.muted}>{query ? `${query}   ·   ${savedOnly ? 'saved passages' : filter ? store.book(filter).name : 'all books'}` : 'Jump to a passage or search a word / phrase'}</text>}
    </HoverBox>}
    {editing && notice && <box height={2} paddingX={2} flexShrink={0}><text fg={p.accent}>{notice}</text></box>}
    {!(exploreVisible || compact && askVisible) && <box height={height < 26 ? 1 : 2} paddingX={2} flexDirection="row" justifyContent="space-between" flexShrink={0}>
      {mode === 'workspace' ? <box flexDirection="row" gap={1}>
        {readingFromExplore && <Action p={p} onPress={backToExplore}>← {exploreSection}</Action>}
        <Action p={p} active={visible('results')} onPress={() => togglePanel('results')}>{width >= 80 ? 'r Results' : 'r Find'}</Action>
        <Action p={p} active={visible('compare') && !askVisible} onPress={() => togglePanel('compare')}>c Compare</Action>
        <Action p={p} active={visible('atlas')} onPress={() => togglePanel('atlas')}>a Atlas</Action>
        {width >= 80 && <Action p={p} active={focusMode} onPress={toggleFocus}>f Focus</Action>}
      </box> : <text fg={notice ? p.accent : p.muted}>{notice || subtitles[mode]}</text>}
      {width >= 110 && <Action p={p} active={savedOnly} onPress={showSaved}>Saved {saved.length}</Action>}
    </box>}
    {sourcesOpen && !help && rabbinic && <scrollbox flexGrow={1} minHeight={0} marginX={2} scrollX={false} contentOptions={{padding:1}} {...scrollIndicators(p)}><text fg={p.accent}>{libraryName.toUpperCase()} · SOURCES & COVERAGE</text><text fg={p.fg}>{book.name}</text><box marginY={1}><text fg={p.muted}>Containing work · segments: {store.coverageFor?.(book.id).segments} · Original: {store.coverageFor?.(book.id).original} · English: {store.coverageFor?.(book.id).english}</text><text fg={p.muted}>Coverage describes the imported editions, not completeness of the entire historical work. Gaps are shown explicitly; no machine translations are substituted.</text></box>{store.sourcesFor?.(book.id).map(source=><box key={source.edition} marginBottom={1}><text fg={p.accent}>{source.edition==='original'?'Hebrew / Aramaic':'English'} · {source.license}</text><text fg={p.fg}>{source.versionTitle}</text><text fg={p.muted}>{source.versionSource}</text></box>)}<text fg={p.muted}>Source: Sefaria Export. HTML formatting is flattened for terminal display. Inline edition footnotes appear under Notes. English editions may include translator explanations.</text><text fg={p.muted}>Connections are scoped to this library. Search runs locally; Ask sends retrieved text to your Codex subscription.</text><Action p={p} onPress={()=>setSourcesOpen(false)}>← Back [Esc]</Action></scrollbox>}
    {sourcesOpen && !help && torah && <scrollbox flexGrow={1} marginX={2} scrollX={false} contentOptions={{padding: 2}} {...scrollIndicators(p)}><text fg={p.accent}>TORAH SOURCES</text><text fg={p.fg}>Hebrew: Tanach with Ta'amei Hamikra · Public Domain</text><text fg={p.fg}>English: JPS 1917 · Public Domain</text><text fg={p.muted}>Texts: Sefaria Export · Hebrew source: tanach.us. Verse numbering follows these editions. Connections: Sefaria, limited to the five Torah books.</text><text fg={p.muted}>Topic search: multilingual E5-small (MIT); refinement: BGE reranker v2-m3 INT8 (Apache-2.0). Search runs locally. Ask sends retrieved passages to your Codex subscription.</text><text fg={p.muted}>Hebrew display uses Unicode bidi. Copy preserves original text order and marks.</text>{hebrewRendererError() && <text fg={p.accent}>{hebrewRendererError()}</text>}<Action p={p} onPress={() => setSourcesOpen(false)}>← Back [Esc]</Action></scrollbox>}
    {help && <scrollbox flexGrow={1} marginX={2} contentOptions={{ padding: 2 }} border borderColor={p.line} scrollX={false}>
      <text fg={p.accent}><strong>A FEW KEYS. A WHOLE LIBRARY.</strong></text>
      <box marginTop={1}><text fg={p.fg}>{'/          search words, phrases, or a reference\n' + (mode === 'workspace' ? 'r / c / a  toggle results / comparison / Atlas\nx          explore books, topics, and connections\ni          Ask the selected library using Codex\ne          edit question when Ask is open\nw / p      Whole library / This passage (outside input)\nf          focus reading; press again to restore panels\n1 / 2 / 3  study / focus / study with Atlas presets\n' : '1 / 2 / 3  Study Desk / Reader / Atlas\n0          combined workspace\n') + 'Tab        switch between results and passage\n↑ ↓ / j k  select previous / next verse or result\nEnter      focus passage\n[ ] / ← →  previous / next chapter\nPgUp PgDn  scroll the focused pane (Ask when open)\nv          switch edition\ny          copy original verse text\nb          save or unsave the selected passage\ns          browse saved passages\nEsc        stop answer / close search or panel\nq          quit'}</text></box>
      {mode === 'workspace' && <box marginTop={1}><text fg={p.accent}>IN EXPLORE</text><text fg={p.fg}>{'o / u / g  Books / Topics / Connections\nBooks:     / find a book; Enter overview, then read\n           h chapters; arrows choose; Enter read\n           Tab library / overview; ⌫ return to library\nTopics:    / type a topic; Enter search or read\n           z refine; i ask; g trace selected passage\nConnections: ↑ ↓ preview; Enter / → follow\n           ⌫ / ← back; l / t links / chapter context\n           n / p page links; i explain with Codex\nPgUp PgDn  scroll the focused pane'}</text><text fg={p.muted}>Hover previews; clicking follows. Links: {store.profile.linksCredit}. Links are editorial study aids.</text></box>}
      <box marginTop={1}>{jewish && <text fg={p.muted}>d parallel reading · m full/vowels/plain Hebrew marks</text>}<text fg={p.muted}>Search matches word prefixes. Use quotes for an exact phrase. F4 switches Bible / Torah; F5 opens all libraries.</text><text fg={p.muted}>Book tiles, verses, and controls also respond to the mouse. Backspace returns to your exploration after opening a chapter.</text></box>
      <HoverBox p={p} backgroundColor={p.bg} marginTop={1} onMouseDown={() => setHelp(false)}><text fg={p.accent}>Close help  [Esc]</text></HoverBox>
    </scrollbox>}
    <box visible={!help && !sourcesOpen} flexGrow={1} minHeight={0} marginX={2} gap={1} flexDirection="row">
      {mode === 'workspace' && workspace}
      {mode === 'study' && <>
        {(width >= 90 || focus === 'results') && <box width={width >= 90 ? 29 : '100%'} minHeight={0}>{resultList}</box>}
        {(width >= 90 || focus === 'passage') && passage()}
        {width >= 125 && inspector}
      </>}
      {mode === 'reader' && <>
        {focus === 'results' && <box width={width >= 100 ? 30 : '100%'} minHeight={0}>{resultList}</box>}
        {(width >= 100 || focus !== 'results') && <box flexGrow={1} minHeight={0} alignItems="center"><box width={Math.min(width - (focus === 'results' ? 38 : 6), 82)} height="100%" minHeight={0}>{passage(true)}</box></box>}
      </>}
      {mode === 'atlas' && <>
        {width >= 100 ? <>{atlasMap}<box width={37} minHeight={0} gap={1}>{resultList}<box height={12} flexShrink={0} padding={1} backgroundColor={p.panel} border={['top']} borderColor={p.line}><text fg={p.accent}>{selected ? store.label(selected) : 'SELECTED PASSAGE'} · {translation}</text><box marginTop={1} flexGrow={1} minHeight={0}><ScriptureText fg={p.fg} maxHeight={6} text={selected?.text ?? ''} translation={translation} /></box><Action p={p} onPress={() => { setMode('reader'); setFocus('passage'); }}>Read in context ↗  [Enter]</Action></box></box></> : <box flexGrow={1} minHeight={0}>{focus === 'results' ? resultList : atlasMap}</box>}
      </>}
    </box>
    <box height={2} flexShrink={0} paddingX={2} paddingTop={1} flexDirection="row" justifyContent="space-between" gap={1}>
      <text fg={notice ? p.accent : p.muted} flexGrow={1} minWidth={0} maxHeight={1}>{notice || (help ? 'Esc closes help' : exploreVisible ? 'Esc back · scroll for more' : askVisible ? askEditing ? 'Enter ask · Esc navigate' : 'PgUp/PgDn scroll · Esc back' : readingFromExplore ? '⌫ back to exploration · / search' : width >= 100 ? '/ search · ↑↓ select · [ ] chapter · b save' : '/ search · ↑↓ select · b save')}</text>
      {(width >= 110 || torah && width >= 80 && !exploreVisible) && <text fg={p.accent}>{selected ? store.label(selected) : ''}</text>}
      <Action p={p} onPress={switchVersion}>{editionName(translation)} ⇄</Action>{jewish && <Action p={p} active={sourcesOpen} onPress={() => { setSourcesOpen(value => !value); setEditing(false); setAskEditing(false); }}>Sources</Action>}
      <Action p={p} active={help} onPress={() => { setHelp(value => !value); setAskEditing(false); setEditing(false); }}>? Help</Action>
    </box>
    </box>
  </box></HebrewMarksContext.Provider>;
}
