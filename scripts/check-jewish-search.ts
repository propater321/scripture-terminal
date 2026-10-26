import { strict as assert } from 'node:assert';
import { JewishStore, type JewishLibraryId } from '../src/jewish-store';
import { HybridSearch } from '../src/search';
const reports=[];
for(const library of ['mishnah','yerushalmi','midrash','zohar','shulchan','bavli'] as JewishLibraryId[]){
 const store=new JewishStore(library,':memory:'),search=new HybridSearch(store);
 try{
  for(const [query,translation,refine] of [['prayer and intention','english',false],['שבת ומנוחה','original',false],['prayer and intention','english',true]] as const){
   const result=await search.search(query,translation,{limit:8,rerank:refine});
   assert.equal(result.mode,'hybrid',result.notice ?? '');assert.ok(!result.notice,result.notice??'');assert.ok(result.hits.length>0);if(refine)assert.ok(result.reranked);
   for(const hit of result.hits){const passage=store.passage(hit.range,hit.translation);assert.ok(passage.verses.length);assert.equal(passage.label,hit.label);assert.equal(passage.verses.map(v=>v.text).join(' '),hit.text);assert.ok(store.books.some(b=>b.id===hit.range.start.book_id));}
   if(library==='zohar')assert.ok(result.hits.every(h=>h.translation==='english'));
   const report={library,query,translation,refine,ms:Math.round(result.elapsedMs),count:result.indexedPassages,references:result.hits.map(h=>h.label)};reports.push(report);console.log(JSON.stringify(report));
  }
 }finally{search.close();store.close();}
}
await Bun.write('previews/jewish-search-evaluation.json',JSON.stringify(reports,null,2)+'\n');
