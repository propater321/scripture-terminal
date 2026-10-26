import { Terminal } from '@xterm/headless';
import { strict as assert } from 'node:assert';
import { visualHebrewLine } from '../src/hebrew';
const terminal = new Terminal({cols:140,rows:44,allowProposedApi:true});
const child = Bun.spawn(['bash','bin/scripture','torah'],{cwd:new URL('..',import.meta.url).pathname,env:{...process.env,TERM:'xterm-256color',COLORTERM:'truecolor'},terminal:{cols:140,rows:44,data(_pty,bytes){terminal.write(bytes);}}});
terminal.onData(data=>child.terminal!.write(data));
const frame=()=>Array.from({length:terminal.rows},(_,y)=>terminal.buffer.active.getLine(y)?.translateToString(false, 0, terminal.cols)??'').join('\n');
async function waitFor(text:string){const until=Date.now()+6000;while(!frame().includes(text)&&Date.now()<until)await Bun.sleep(40);assert.ok(frame().includes(text),`Missing ${text}:\n${frame()}`);}
async function send(text:string){child.terminal!.write(text);await Bun.sleep(120);}
try{
 await waitFor('EXPLORE THE TORAH');await send('\r');await send('\r');await waitFor('In the beginning God created');
 await send('d');await send('v');await send('m');await send('m');await waitFor(visualHebrewLine('בראשית'));assert.ok(!frame().includes('In the beginning God created'));
 await send('v');await waitFor('In the beginning God created');
 await send('/');await send('Shemot 3:14');await send('\r');await waitFor('Exodus 3:14');
 await send('\x1bOS');await waitFor('JOHN  1');
 await send('\x1bOS');await waitFor('EXODUS  3');
 await send('i');await waitFor('Whole Torah');await send('\x1b');await send('\x1b');
 await send('x');await send('g');await waitFor('Sefaria');await send('\x1b');
 await send('a');await waitFor('ATLAS');await send('a');await send('f');
 await send('/');await send('בראשית');await send('\r');await waitFor('SEARCH RESULTS');await send('\r');await waitFor('GENESIS  1');
 await send('f');await send('d');
 for(const [cols,rows] of [[80,24],[60,18]]){terminal.resize(cols,rows);child.terminal!.resize(cols,rows);await Bun.sleep(200);await waitFor('In the beginning God created');await waitFor('y Copy');assert.ok(frame().includes('Parallel'));}
 await send('q');assert.equal(await Promise.race([child.exited,Bun.sleep(2000).then(()=> 'timeout')]),0);
 console.log('Torah: shared Explore/Ask/Atlas, bilingual reader, marks, references, Hebrew search, library switching, 60×18 reading and clean exit passed.');
}finally{if(child.exitCode===null)child.kill();child.terminal?.close();terminal.dispose();}
