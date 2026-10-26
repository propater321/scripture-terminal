import { strict as assert } from 'node:assert';
import { TorahStore } from '../src/torah-store';
import { TorahAdapter } from '../src/torah-adapter';
import { HybridSearch } from '../src/search';
const torah=new TorahStore(':memory:'),store=new TorahAdapter(torah),search=new HybridSearch(store);
const reports=[];
try{
 for(const [query,translation,book,rerank] of [
  ['care for strangers and foreigners','jps1917',undefined,false],
  ['שמירת שבת ומנוחה','hebrew',undefined,false],
  ['care for strangers and foreigners','hebrew',3,false],
  ['ואהבתם את הגר','jps1917',undefined,false],
  ['caring for the stranger','jps1917',undefined,true],
  ['שמירת שבת ומנוחה','hebrew',2,true],
 ] as const){
  const result=await search.search(query,translation,{limit:10,book,rerank});
  assert.equal(result.mode,'hybrid');assert.equal(result.indexedPassages,3900);assert.ok(result.hits.length>0);assert.ok(!result.notice,result.notice ?? '');if(rerank)assert.equal(result.reranked,true);
  assert.ok(result.hits.every(h=>h.translation===translation&&h.range.start.book_id<=5&&(!book||h.range.start.book_id===book)));
  if(query.includes('strangers'))assert.ok(result.hits.some(h=>h.range.start.book_id===3&&h.range.start.chapter===19&&h.range.start.verse<=34&&h.range.end.verse>=34));
  if(query==='ואהבתם את הגר')assert.ok(result.hits.some(h=>h.range.start.book_id===5&&h.range.start.chapter===10&&h.range.start.verse<=19&&h.range.end.verse>=19));
  if(query.includes('שבת'))assert.ok(result.hits.some(h=>h.range.start.book_id===2&&h.range.start.chapter===31));
  const report={query,translation,book,rerank,ms:Math.round(result.elapsedMs),references:result.hits.map(h=>h.label)};reports.push(report);console.log(JSON.stringify(report));
 }
 await Bun.write('previews/torah-search-evaluation.json',JSON.stringify(reports,null,2)+'\n');
}finally{search.close();store.close();torah.close();}
