import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';
const record=(value:unknown)=>appendFileSync(process.env.SCRIPTURE_TEST_TRACE!,JSON.stringify(value)+'\n');
const send=(value:unknown)=>process.stdout.write(JSON.stringify(value)+'\n');
record({apiKeyPresent:!!process.env.OPENAI_API_KEY,tokenPresent:!!process.env.CODEX_ACCESS_TOKEN,args:process.argv.slice(2)});
for await(const line of createInterface({input:process.stdin})){
 const m=JSON.parse(line);record(m);
 if(m.method==='initialize')send({id:m.id,result:{}});
 else if(m.method==='account/read')send({id:m.id,result:{account:{type:process.env.SCRIPTURE_TEST_MODE==='apikey'?'apiKey':'chatgpt',planType:'test'},requiresOpenaiAuth:true}});
 else if(m.method==='model/list')send({id:m.id,result:{data:[{model:'fixture-model',isDefault:true,supportedReasoningEfforts:[{reasoningEffort:'medium'}]}]}});
 else if(m.method==='config/read')send({id:m.id,result:{config:{mcp_servers:{fixture:{}}}}});
 else if(m.method==='thread/start')send({id:m.id,result:{thread:{id:'thread-1'},model:'fixture-model',modelProvider:'openai'}});
 else if(m.method==='turn/start'){
  send({id:m.id,result:{turn:{id:'turn-1'}}});
  if(process.env.SCRIPTURE_TEST_MODE!=='hang')send({id:'unexpected-1',method:'item/commandExecution/requestApproval',params:{threadId:'thread-1'}});
 }
 else if(m.id==='unexpected-1')send({id:'tool-1',method:'item/tool/call',params:{tool:'bible_read',arguments:{reference:'Fixture 1:1'}}});
 else if(m.id==='tool-1')send({method:'turn/completed',params:{threadId:'thread-1',turn:{status:'completed',items:[{type:'agentMessage',text:JSON.stringify({answer:'Fixture answer [S1].',citations:['S1'],insufficientEvidence:false})}]}}});
}
