import { BibleStore } from '../src/store';
import { HybridSearch, type SearchMode } from '../src/search';
import { mkdir } from 'node:fs/promises';
const cases: { query: string; relevant: [number, number, number, number][] }[] = [
  { query: 'Finding peace when I feel anxious and afraid', relevant: [[50,4,4,9],[40,6,25,34],[60,5,6,10]] },
  { query: 'Forgiving someone who has hurt me', relevant: [[40,18,21,35],[49,4,25,32],[42,6,27,37]] },
  { query: 'A father welcomes home his son who wasted his inheritance', relevant: [[42,15,11,32]] },
  { query: 'Treating foreigners and immigrants with kindness', relevant: [[3,19,33,34],[5,10,17,19],[2,22,21,21]] },
  { query: 'Controlling the words I say and avoiding harmful speech', relevant: [[59,3,1,12],[20,15,1,4],[49,4,25,32]] },
  { query: 'Showing love through actions rather than words alone', relevant: [[62,3,16,18],[59,2,14,17]] },
  { query: 'Wealth does not make life meaningful', relevant: [[42,12,13,21],[21,5,10,17],[54,6,6,19]] },
  { query: 'Hope when grieving the death of someone I love', relevant: [[52,4,13,18],[43,11,17,44],[66,21,1,5]] },
  { query: 'Working honestly instead of stealing from others', relevant: [[49,4,25,32],[53,3,6,12]] },
  { query: 'Jesus tells a story about a Samaritan helping an injured stranger', relevant: [[42,10,25,37]] },
  { query: 'Love is patient and kind', relevant: [[46,13,1,13]] },
  { query: 'Trusting God when I do not understand suffering', relevant: [[18,1,20,22],[35,3,16,19],[20,3,5,6],[45,8,18,39]] },
];
const store = new BibleStore(':memory:'), search = new HybridSearch(store);
type EvaluationMode = SearchMode | 'hybrid-refined';
const results: { mode: EvaluationMode; query: string; hitAt5: boolean; hitAt10: boolean; rank: number | null; elapsedMs: number; references: string[] }[] = [];
try {
  for (const mode of ['keyword', 'semantic', 'hybrid', 'hybrid-refined'] as EvaluationMode[]) {
    for (const item of cases) {
      const found = await search.search(item.query, 'WEB', { mode: mode === 'hybrid-refined' ? 'hybrid' : mode, rerank: mode === 'hybrid-refined', limit: 10 });
      if (found.mode !== (mode === 'hybrid-refined' ? 'hybrid' : mode) || mode === 'hybrid-refined' && !found.reranked) throw new Error(found.notice ?? 'Requested retrieval mode unavailable');
      const rank = found.hits.findIndex(hit => item.relevant.some(([book, chapter, first, last]) => hit.range.start.book_id === book && hit.range.start.chapter === chapter && hit.range.start.verse <= last && hit.range.end.verse >= first));
      results.push({ mode, query: item.query, hitAt5: rank >= 0 && rank < 5, hitAt10: rank >= 0, rank: rank < 0 ? null : rank + 1, elapsedMs: Math.round(found.elapsedMs), references: found.hits.map(hit => hit.label) });
    }
  }
  const summaries = ['keyword','semantic','hybrid','hybrid-refined'].map(mode => {
    const group = results.filter(row => row.mode === mode);
    return { mode, questions: group.length, hitAt5: group.filter(row => row.hitAt5).length, hitAt10: group.filter(row => row.hitAt10).length, meanReciprocalRank: +(group.reduce((sum,row)=>sum+(row.rank ? 1/row.rank : 0),0)/group.length).toFixed(3), medianMs: group.map(row=>row.elapsedMs).sort((a,b)=>a-b)[Math.floor(group.length/2)] };
  });
  await mkdir(new URL('../previews',import.meta.url),{recursive:true});
  await Bun.write(new URL('../previews/search-evaluation.json', import.meta.url), JSON.stringify({ note: 'Small, hand-selected development set. Hit rate against illustrative passages, not a comprehensive relevance benchmark.', cases, summaries, results }, null, 2));
  console.log(JSON.stringify(summaries,null,2));
  for (const result of results.filter(row=>row.mode==='hybrid')) console.log(JSON.stringify({query:result.query,rank:result.rank,top:result.references.slice(0,5)}));
} finally { search.close(); store.close(); }
