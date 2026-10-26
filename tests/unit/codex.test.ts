import {afterEach,expect,test} from 'bun:test';
import {mkdtemp,writeFile,chmod,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {askCodex} from '../../src/codex';
import type {StudyRequest} from '../../src/study';
let directory='';let original:Record<string,string|undefined>={};
afterEach(async()=>{for(const [key,value]of Object.entries(original)){if(value===undefined)delete process.env[key];else process.env[key]=value;}original={};if(directory)await rm(directory,{recursive:true,force:true});directory='';});
async function setup(mode='normal'){
 directory=await mkdtemp(join(tmpdir(),'scripture-codex-test-'));
 for(const key of ['PATH','OPENAI_API_KEY','CODEX_ACCESS_TOKEN','SCRIPTURE_TEST_TRACE','SCRIPTURE_TEST_MODE'])original[key]=process.env[key];
 const fixture=new URL('../fixtures/fake-codex.ts',import.meta.url).pathname;
 await writeFile(join(directory,'codex'),`#!${process.execPath}\nimport ${JSON.stringify(fixture)};\n`);await chmod(join(directory,'codex'),0o700);
 Object.assign(process.env,{PATH:directory+':'+original.PATH,OPENAI_API_KEY:'fixture-only-key',CODEX_ACCESS_TOKEN:'fixture-only-token',SCRIPTURE_TEST_TRACE:join(directory,'trace.jsonl'),SCRIPTURE_TEST_MODE:mode});
}
const request=():StudyRequest=>({question:'Fixture question',passage:'Fixture 1:1',scope:'bible',sources:[{id:'S1',label:'Fixture 1:1',verse:{id:1,translation:'WEB',book_id:1,chapter:1,verse:1,text:'Fixture evidence'}}]});
async function trace(){return (await readFile(join(directory,'trace.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));}
test('Codex boundary uses managed login, strips API credentials, isolates tools and fails closed on approvals',async()=>{
 await setup();const req=request();let reads=0;req.tools={definitions:[{type:'function',name:'bible_read',description:'Fixture',inputSchema:{type:'object',properties:{reference:{type:'string'}},required:['reference']}}],async call(name){expect(name).toBe('bible_read');reads++;return {sources:req.sources};}};
 const result=await askCodex(req,new AbortController().signal,()=>{});expect(result.sources[0].id).toBe('S1');expect(reads).toBe(1);
 const rows=await trace();expect(rows[0]).toMatchObject({apiKeyPresent:false,tokenPresent:false});
 const thread=rows.find(r=>r.method==='thread/start').params;expect(thread).toMatchObject({ephemeral:true,approvalPolicy:'never',sandbox:'read-only',config:{'mcp_servers.fixture.enabled':false}});
 expect(rows.find(r=>r.id==='unexpected-1').error.code).toBe(-32601);
});
test('API-key accounts are rejected before creating a thread',async()=>{
 await setup('apikey');await expect(askCodex(request(),new AbortController().signal,()=>{})).rejects.toThrow('subscription');expect((await trace()).some(r=>r.method==='thread/start')).toBe(false);
});
test('cancelling Ask terminates the waiting child rather than leaving the request pending',async()=>{
 await setup('hang');const controller=new AbortController();const pending=askCodex(request(),controller.signal,()=>{});const timer=setTimeout(()=>controller.abort(),150);
 try{await expect(pending).rejects.toThrow('Stopped');}finally{clearTimeout(timer);}
});
