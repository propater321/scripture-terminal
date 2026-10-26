import { strict as assert } from 'node:assert';
import { TorahStore } from '../src/torah-store';
import { TorahAdapter } from '../src/torah-adapter';
import { HybridSearch } from '../src/search';
import { wholeBibleRequest } from '../src/research';
import { askCodex } from '../src/codex';
const torah=new TorahStore(':memory:'),store=new TorahAdapter(torah),search=new HybridSearch(store),controller=new AbortController();
const timer=setTimeout(()=>controller.abort(),180000);
try{
 const calls:{name:string;args:unknown}[]=[];
 const request=await wholeBibleRequest(store,search,'How does the Torah say we should treat strangers? Compare one central Hebrew verse with JPS 1917.','jps1917',controller.signal,p=>console.log(p.status));
 const call=request.tools!.call;request.tools!.call=async(name,args)=>{calls.push({name,args});return call(name,args);};
 const answer=await askCodex(request,controller.signal,p=>console.log(p.status));
 assert.ok(answer.sources.length);assert.ok(calls.some(c=>c.name==='torah_read'));
 assert.ok(answer.sources.every(s=>s.verse.book_id>=1&&s.verse.book_id<=5&&['hebrew','jps1917'].includes(s.verse.translation)));
 assert.ok(request.sources.some(s=>s.verse.translation==='hebrew'));
 for(const source of answer.sources)assert.equal(source.verse.text,store.verse(source.verse.book_id,source.verse.chapter,source.verse.verse,source.verse.translation)!.text);
 await Bun.write('previews/torah-research-answer.json',JSON.stringify({question:request.question,collection:request.collection,calls,...answer},null,2)+'\n');
 console.log(JSON.stringify({passed:true,model:answer.model,calls:calls.length,citations:answer.sources.length}));
}finally{clearTimeout(timer);search.close();store.close();torah.close();}
