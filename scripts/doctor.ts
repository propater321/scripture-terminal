import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { hebrewRendererError } from '../src/hebrew';
import { jewishLibraries } from '../src/jewish-store';
import { version } from '../package.json';
const root=join(import.meta.dir,'..');let errors=0;
console.log(`Scripture ${version} · ${process.platform}/${process.arch} · Bun ${Bun.version}`);
if(process.platform!=='linux')console.log('NOTE: This release is validated on Linux. Other platforms are not yet supported.');
console.log(hebrewRendererError() ?? 'OK: Hebrew/Aramaic display (FriBidi)');
for(const id of ['bible','torah',...Object.keys(jewishLibraries)]){
 const path=join(root,'data',id+'.sqlite');
 if(!existsSync(path)){console.log(`${id==='bible'?'REQUIRED':'OPTIONAL'}: ${id} text is not installed.`);if(id==='bible')errors++;continue;}
 try{
  const db=new Database(path,{readonly:true});
  try{const rows=db.query<{n:number},[]>('SELECT count(*) n FROM verses').get()!.n;console.log(`OK: ${id} · ${rows.toLocaleString()} text records`);}finally{db.close();}
 }catch{console.log(`ERROR: ${id} database is unreadable. Re-run its import.`);errors++;}
}
for(const name of ['python3','uv','codex'])console.log(`${Bun.which(name)?'OK':'OPTIONAL'}: ${name}${Bun.which(name)?' available':' not installed'}`);
console.log(existsSync(join(root,'.venv-search/bin/python'))?'OK: local semantic-search runtime':'OPTIONAL: meaning search needs bun run setup:search; keyword search works without it.');
console.log('Bookmarks: data/study.sqlite. Back it up before removing this checkout.');
if(errors)console.log('Start with bun run import, then ./bin/scripture. See README.md for optional libraries.');
process.exitCode=errors?1:0;
