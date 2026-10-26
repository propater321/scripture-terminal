import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';
import { App, type Mode } from './app';
import { BibleStore, type LibraryId } from './store';
import { jewishLibraries } from './jewish-store';
import {version} from '../package.json';
if (process.argv.includes('--version')) { console.log(`Scripture Terminal ${version}`); process.exit(0); }
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Scripture Terminal: workspace | study | reader | atlas | explore | torah | bavli | yerushalmi | mishnah | midrash | zohar | shulchan\nF5 libraries · / search · x Explore · i Ask · ? help · q quit');
  process.exit(0);
}

if (!process.stdout.isTTY) {
  console.error('Open in a terminal: scripture (or run bun start from the project directory).');
  process.exit(1);
}
const requestedMode = process.argv[2] ?? 'workspace';
const isLibrary = requestedMode === 'torah' || Object.hasOwn(jewishLibraries, requestedMode);
const mode = requestedMode === 'explore' || isLibrary ? 'workspace' : requestedMode;
if (!['workspace', 'study', 'reader', 'atlas'].includes(mode)) {
  console.error('Choose workspace, study, reader, atlas, explore, torah, bavli, yerushalmi, mishnah, midrash, zohar, or shulchan.'); process.exit(1);
}
if (!await Bun.file(new URL('../data/bible.sqlite', import.meta.url)).exists()) {
  console.error('Download the text first: bun run import'); process.exit(1);
}
let store: BibleStore;
try { store = new BibleStore(); } catch { console.error('The local Bible database could not be opened. Run bun run doctor or bun run import.');process.exit(1); }
const renderer = await createCliRenderer({ exitOnCtrlC: true, screenMode: 'alternate-screen', useMouse: true, enableMouseMovement: true, consoleMode: 'disabled' });
createRoot(renderer).render(<App store={store} initialMode={mode as Mode} initialExplore={requestedMode === 'explore'} initialLibrary={isLibrary ? requestedMode as LibraryId : 'bible'} />);
try { await renderer.closed; } finally { store.close(); }
