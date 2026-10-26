import { strict as assert } from 'node:assert';
import { JewishStore } from '../src/jewish-store';
import { HybridSearch } from '../src/search';
import { wholeBibleRequest } from '../src/research';
import { askCodex } from '../src/codex';
const store=new JewishStore('bavli',':memory:'),search=new HybridSearch(store),controller=new AbortController();
const timer=setTimeout(()=>controller.abort(),180000);
try{
 const calls:{name:string;args:unknown}[]=[];
 const request=await wholeBibleRequest(store,search,'In Berakhot 2a, how is the beginning of the evening Shema time determined? Read the opening discussion in English and the original, and distinguish the Mishnah from the Gemara.','english',controller.signal,p=>console.log(p.status));
 const call=request.tools!.call;request.tools!.call=async(name,args)=>{calls.push({name,args});return call(name,args);};
 const answer=await askCodex(request,controller.signal,p=>console.log(p.status));
 assert.ok(answer.sources.length);assert.ok(calls.some(c=>c.name==='bavli_read'));
 assert.ok(answer.sources.every(s=>['english','original'].includes(s.verse.translation)));
 for(const source of answer.sources)assert.equal(source.verse.text,store.verse(source.verse.book_id,source.verse.chapter,source.verse.verse,source.verse.translation)!.text);
 await Bun.write('previews/bavli-research-answer.json',JSON.stringify({question:request.question,collection:request.collection,calls,...answer},null,2)+'\n');
 console.log(JSON.stringify({passed:true,model:answer.model,calls:calls.length,citations:answer.sources.length}));
}finally{clearTimeout(timer);search.close();store.close();}
