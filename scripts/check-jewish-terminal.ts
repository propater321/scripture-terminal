import { Terminal } from '@xterm/headless';
import { strict as assert } from 'node:assert';
const ids=['bavli','yerushalmi','mishnah','midrash','zohar','shulchan'];
for(const library of ids){
 const terminal=new Terminal({cols:100,rows:30,allowProposedApi:true});
 const child=Bun.spawn(['bash','bin/scripture',library],{cwd:new URL('..',import.meta.url).pathname,env:{...process.env,TERM:'xterm-256color',COLORTERM:'truecolor'},terminal:{cols:100,rows:30,data(_pty,bytes){terminal.write(bytes);}}});
 terminal.onData(data=>child.terminal!.write(data));
 const frame=()=>Array.from({length:terminal.rows},(_,y)=>terminal.buffer.active.getLine(y)?.translateToString(false, 0, terminal.cols)??'').join('\n');
 async function waitFor(text:string){const until=Date.now()+8000;while(!frame().includes(text)&&Date.now()<until)await Bun.sleep(40);assert.ok(frame().includes(text),`Missing ${text} in ${library}:\n${frame()}`);}
 async function send(text:string){child.terminal!.write(text);await Bun.sleep(160);}
 try{
  await waitFor('THE WHOLE LIBRARY');assert.ok(!frame().includes('NEW TESTAMENT'));
  await send('\r');await send('\r');await waitFor('y Copy');
  await send(']');await waitFor('y Copy');
  terminal.resize(60,18);child.terminal!.resize(60,18);await Bun.sleep(200);await waitFor('y Copy');await waitFor('Sources');
  await send('i');await waitFor('Whole');await send('\x1b');await send('\x1b');
  await send('\x1b[15~');await waitFor('CHOOSE A LIBRARY');await send('\x1b');await waitFor('y Copy');
  await Bun.write('previews/'+library+'-native-60.txt',frame());
  await send('q');assert.equal(await Promise.race([child.exited,Bun.sleep(2000).then(()=> 'timeout')]),0);console.log(library+': native launch, read, next section, 60×18 layout, Ask, library picker and clean exit passed.');
 }finally{if(child.exitCode===null)child.kill();child.terminal?.close();terminal.dispose();}
}
