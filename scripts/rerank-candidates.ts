import { BibleStore } from '../src/store';
import { HybridSearch } from '../src/search';
const report=await Bun.file(new URL('../previews/search-evaluation.json',import.meta.url)).json();
const store=new BibleStore(':memory:'),search=new HybridSearch(store);
try {
 const candidates=[];
 for(const item of report.cases) {
  const result=await search.search(item.query,'WEB',{limit:30});
  candidates.push({query:item.query,hits:result.hits.map(hit=>({...hit,relevant:item.relevant.some(([book,chapter,first,last]:number[])=>hit.range.start.book_id===book&&hit.range.start.chapter===chapter&&hit.range.start.verse<=last&&hit.range.end.verse>=first)}))});
 }
 await Bun.write(new URL('../previews/rerank-candidates.json',import.meta.url),JSON.stringify(candidates));
}finally{search.close();store.close();}
