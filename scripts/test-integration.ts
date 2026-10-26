import { existsSync } from 'node:fs';
import { join } from 'node:path';
const root=join(import.meta.dir,'..');
const required=['bible','crossrefs',...(process.argv.includes('--all')?['torah','torah-links','bavli','yerushalmi','mishnah','midrash','zohar','shulchan']:[])];
const missing=required.filter(name=>!existsSync(join(root,'data',name+'.sqlite')));
if(missing.length){console.error(`Missing integration data: ${missing.join(', ')}.\nRun bun run import and bun run import:links; --all also requires the optional library imports documented in README.md.`);process.exit(1);}
process.exit(await Bun.spawn([process.execPath,'test','src'],{cwd:root,stdout:'inherit',stderr:'inherit'}).exited);
