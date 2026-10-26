import { expect,test } from 'bun:test';
import { addressKey,decodeAddress,rangeKey,containsVerse } from '../../src/references';
import { literalFts } from '../../src/store';
import { fuseRanks,topicKeywords } from '../../src/search';
import { parseStudyAnswer, instructionsFor, type StudyRequest } from '../../src/study';
import { verifiedCorpus, type Corpus } from '../../scripts/import-bible-validation';
const corpus:Corpus={books:Array.from({length:66},(_,i)=>({book:`B${i}`,bookId:i+1,englishName:`Book ${i}`,testament:i<39?'OT':'NT',chapters:[{chapter:1,verses:[{number:1,text:'Fixture text.'}]}]}))};
function expected(raw:string){return {sha256:new Bun.CryptoHasher('sha256').update(raw).digest('hex'),verses:66,translation:'fixture'};}
test('canonical addresses round-trip across large collections and range boundaries',()=>{
 for(const b of [1,66,354])for(const c of [1,2,997])for(const v of [1,998]){const a={book_id:b,chapter:c,verse:v};expect(decodeAddress(addressKey(a))).toEqual(a);}
 const range={start:{book_id:1,chapter:1,verse:5},end:{book_id:1,chapter:2,verse:2}};expect(containsVerse(range,{book_id:1,chapter:2,verse:1})).toBe(true);expect(containsVerse(range,{book_id:2,chapter:1,verse:1})).toBe(false);expect(rangeKey(range)).toBe('1001005-1002002');
});
test('FTS input treats operators and punctuation as search text',()=>{
 expect(literalFts('*** : "')).toBe('');expect(literalFts('love OR mercy')).not.toBe('love OR mercy');expect(topicKeywords('What does the Bible say about "kingdom of God" and mercy?')).toBe('"kingdom of God" OR "mercy"*');
 expect(fuseRanks([{id:1},{id:2},{id:2}],[{id:2},{id:3}])[0]).toMatchObject({id:2,channels:['keyword','semantic']});
});
test('pinned import rejects edited cache, control sequences, duplicate numbering and missing books',()=>{
 const raw=JSON.stringify(corpus);expect(verifiedCorpus(raw,expected(raw)).books.length).toBe(66);expect(()=>verifiedCorpus(raw+' ',expected(raw))).toThrow('checksum');
 for(const mutate of [(c:Corpus)=>c.books.pop(),(c:Corpus)=>c.books[0].chapters[0].verses.push({number:1,text:'duplicate'}),(c:Corpus)=>c.books[0].chapters[0].verses[0].text='\x1b]52;c;payload\x07']){const c=structuredClone(corpus);mutate(c);const bad=JSON.stringify(c);expect(()=>verifiedCorpus(bad,expected(bad))).toThrow();}
});
test('citation validation rejects invented source IDs and expands valid ranges',()=>{
 const req:StudyRequest={question:'Example',passage:'Example',scope:'bible',sources:[1,2].map(i=>({id:`S${i}`,label:`Fixture ${i}`,verse:{id:i,translation:'WEB',book_id:1,chapter:1,verse:i,text:'Fixture text'}}))};
 expect(parseStudyAnswer(JSON.stringify({answer:'Example [S1–S2]',citations:['S1'],insufficientEvidence:false}),req).sources.length).toBe(2);
 expect(()=>parseStudyAnswer(JSON.stringify({answer:'Example [S3]',citations:['S3'],insufficientEvidence:false}),req)).toThrow('outside');
 expect(()=>parseStudyAnswer(JSON.stringify({answer:'Example',citations:[],insufficientEvidence:false}),req)).toThrow();
 expect(parseStudyAnswer(JSON.stringify({answer:'The evidence is missing.',citations:[],insufficientEvidence:true}),req).insufficientEvidence).toBe(true);
});
test('rabbinic instructions preserve corpus and interpretive boundaries',()=>{
 const text=instructionsFor({collection:'bavli',corpusName:'Babylonian Talmud',corpusSize:37,question:'Example',passage:'Example',scope:'bible',sources:[]});expect(text).toContain('bavli_read');expect(text).not.toContain('66 books');expect(text).toContain('Distinguish speakers');
});
test('launcher help works in a pipe without installed corpora or a terminal',async()=>{
 const proc=Bun.spawn(['bash','bin/scripture','--help'],{cwd:new URL('../..',import.meta.url).pathname,stdout:'pipe',stderr:'pipe'});const out=await new Response(proc.stdout).text();expect(await proc.exited).toBe(0);expect(out).toContain('mishnah');expect(out).toContain('F5');
});
