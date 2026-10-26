import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BibleStore, literalFts, type ScriptureStore, type LibraryProfile, type LibraryId, type Book, type Verse, type Translation } from './store';
import { normalizeTorahSearch } from './torah-store';
import { addressKey, type PassageRange, type VerseAddress } from './references';
export type JewishLibraryId = Exclude<LibraryId,'bible'|'torah'>;
export const jewishLibraries: Record<JewishLibraryId,{name:string;short:string;bookTerm:string;unitTerm:string}> = {
 bavli:{name:'Babylonian Talmud',short:'Bavli',bookTerm:'tractates',unitTerm:'daf'},
 yerushalmi:{name:'Jerusalem Talmud',short:'Yerushalmi',bookTerm:'tractates',unitTerm:'halakhah'},
 mishnah:{name:'Mishnah',short:'Mishnah',bookTerm:'tractates',unitTerm:'chapter'},
 midrash:{name:'Midrash',short:'Midrash',bookTerm:'texts',unitTerm:'section'},
 zohar:{name:'Zohar',short:'Zohar',bookTerm:'portions',unitTerm:'section'},
 shulchan:{name:'Shulchan Aruch',short:'Shulchan',bookTerm:'sections',unitTerm:'siman'},
};
type JewishBook = Book & {ref_title:string;aliases:string;summary:string;work:string};
type Source={versionTitle:string;edition:string;license:string;url:string;versionSource:string};
const normal=(s:string)=>normalizeTorahSearch(s).replaceAll('_',' ').replace(/\s+/g,' ').trim().toLowerCase();
export class JewishStore implements ScriptureStore {
 readonly db:Database;readonly notes:Database;readonly books:JewishBook[];readonly profile:LibraryProfile;
 readonly metadata:{coverage:Record<string,{original:number;english:number;segments:number}>;works:number;retrieved:string};
 links?:Database;linksError?:string;linksMetadata?:BibleStore['linksMetadata'];
 private aliases:{value:string;book:JewishBook}[];
 constructor(readonly library:JewishLibraryId,notesPath=join(import.meta.dir,'../data/study.sqlite'),path=join(import.meta.dir,`../data/${library}.sqlite`)) {
  if(!existsSync(path))throw new Error(`${jewishLibraries[library].name} is not installed. Run bun run import:jewish.`);
  this.db=new Database(path,{readonly:true});
  this.books=this.db.query<JewishBook,[]>('SELECT * FROM books ORDER BY id').all();
  this.metadata=JSON.parse(this.db.query<{json:string},[]>('SELECT json FROM metadata').get()!.json);
  if(!this.books.length)throw new Error('This library contains no readable texts.');
  this.notes=new Database(notesPath);this.notes.exec('CREATE TABLE IF NOT EXISTS library_bookmarks(library TEXT,book_id INTEGER,chapter INTEGER,verse INTEGER,PRIMARY KEY(library,book_id,chapter,verse))');
  const info=jewishLibraries[library];const coverage=Object.values(this.metadata.coverage);const en=coverage.reduce((n,c)=>n+c.english,0),original=coverage.reduce((n,c)=>n+c.original,0);
  this.profile={id:library,name:info.name,shortName:info.short,bookTerm:info.bookTerm,unitTerm:info.unitTerm,segmentTerm:'segments',editions:['english','original'],defaultEdition:en>=original*.8?'english':'original',sourceFile:`${library}.sqlite`,indexFile:`${library}-semantic.sqlite`,versionColumn:'translation',linksSource:'Sefaria',linksCredit:'Sefaria connections within this library'};
  this.aliases=this.books.flatMap(book=>(JSON.parse(book.aliases) as string[]).map(value=>({value:normal(value),book}))).sort((a,b)=>b.value.length-a.value.length);
  const linksPath=join(import.meta.dir,`../data/${library}-links.sqlite`);
  if(existsSync(linksPath)){try{this.links=new Database(linksPath,{readonly:true});this.linksMetadata=JSON.parse(this.links.query<{json:string},[]>('SELECT json FROM metadata').get()!.json);}catch{this.links?.close();this.links=undefined;}}
  if(!this.links)this.linksError='Connections are not installed yet. Chapter/section context is available.';
 }
 book(id:number){const b=this.books.find(b=>b.id===id);if(!b)throw new Error('That text is outside this library.');return b;}
 unitLabel(book:number,chapter:number){return this.db.query<{label:string},number[]>('SELECT label FROM units WHERE book_id=? AND chapter=?').get(book,chapter)?.label??String(chapter);}
 label(ref:VerseAddress){return this.db.query<{reference:string},number[]>('SELECT reference FROM segments WHERE book_id=? AND chapter=? AND verse=?').get(ref.book_id,ref.chapter,ref.verse)?.reference??`${this.book(ref.book_id).ref_title} ${this.unitLabel(ref.book_id,ref.chapter)}:${ref.verse}`;}
 rangeLabel(range:PassageRange){const first=this.label(range.start);if(addressKey(range.start)===addressKey(range.end))return first;return first+'–'+(range.start.book_id===range.end.book_id&&range.start.chapter===range.end.chapter?range.end.verse:this.label(range.end));}
 private edition(v:Translation){if(v!=='original'&&v!=='english')throw new Error('Choose Original or English for this library.');return v;}
 chapter(book:number,chapter:number,translation:Translation):Verse[]{
  this.edition(translation);return this.db.query<Verse,any[]>(`SELECT coalesce(v.id,-(s.book_id*1000000+s.chapter*1000+s.verse)) id,? translation,s.book_id,s.chapter,s.verse,coalesce(v.text,'') text,v.notes,(v.id IS NULL) missing FROM segments s LEFT JOIN verses v ON v.book_id=s.book_id AND v.chapter=s.chapter AND v.verse=s.verse AND v.translation=? WHERE s.book_id=? AND s.chapter=? ORDER BY s.verse`).all(translation,translation,book,chapter);
 }
 verse(book:number,chapter:number,verse:number,translation:Translation){this.edition(translation);return this.db.query<Verse,any[]>('SELECT id,translation,book_id,chapter,verse,text,notes FROM verses WHERE book_id=? AND chapter=? AND verse=? AND translation=?').get(book,chapter,verse,translation);}
 resolveReference(value:string,_translation:Translation):PassageRange {
  const parts=value.replace(/[–—]/g,'-').split('-');if(parts.length>2)throw new Error('Use one reference range.');
  const resolve=(input:string,defaultBook?:JewishBook):PassageRange=>{
   const q=normal(input);const alias=this.aliases.find(a=>q.startsWith(a.value+' '));
   const book=alias?.book??defaultBook;if(!book)throw new Error(`Reference is outside ${this.profile.name}. Choose a text in this library.`);
   const suffix=(alias?q.slice(alias.value.length).trim():q).replace(/[.,]/g,':');
   if(!/^\d+[ab]?(?::\d+)*$/.test(suffix))throw new Error('Use the reference shown in the reader (for example '+this.label({book_id:book.id,chapter:1,verse:1})+').');
   const ref=book.ref_title+' '+suffix;
   const exact=this.db.query<VerseAddress,any[]>('SELECT book_id,chapter,verse FROM segments WHERE reference=? COLLATE NOCASE').get(ref);
   if(exact)return {start:exact,end:exact};
   const rows=this.db.query<VerseAddress,any[]>('SELECT book_id,chapter,verse FROM segments WHERE book_id=? AND reference LIKE ? ORDER BY chapter,verse').all(book.id,ref+':%');
   if(!rows.length)throw new Error('That reference is not present in the installed edition.');
   return {start:rows[0],end:rows.at(-1)!};
  };
  const range=resolve(parts[0]);
  if(parts[1]){
   if(/^\d+$/.test(parts[1])&&range.start.chapter===range.end.chapter&&range.start.verse===range.end.verse)range.end={...range.start,verse:Number(parts[1])};
   else range.end=resolve(parts[1],this.book(range.start.book_id)).end;
   if(!this.db.query('SELECT 1 FROM segments WHERE book_id=? AND chapter=? AND verse=?').get(range.end.book_id,range.end.chapter,range.end.verse)||addressKey(range.end)<addressKey(range.start))throw new Error('Invalid or reversed reference range.');
  }
  return range;
 }
 parseReference(value:string){if(!/\d/.test(value) || !this.aliases.some(a=>normal(value).startsWith(a.value+' ')))return null;const range=this.resolveReference(value,this.profile.defaultEdition);return {book:this.book(range.start.book_id),chapter:range.start.chapter,verse:range.start.verse,end:range.start.chapter===range.end.chapter&&range.start.verse!==range.end.verse?range.end.verse:undefined};}
 passage(range:PassageRange,translation:Translation,limit=80){this.edition(translation);const args=[addressKey(range.start),addressKey(range.end)];const where='(book_id*1000000+chapter*1000+verse) BETWEEN ? AND ?';const verses=this.db.query<Verse,any[]>(`SELECT id,translation,book_id,chapter,verse,text,notes FROM verses WHERE translation=? AND ${where} ORDER BY book_id,chapter,verse LIMIT ?`).all(translation,...args,limit);const total=this.db.query<{n:number},any[]>(`SELECT count(*) n FROM verses WHERE translation=? AND ${where}`).get(translation,...args)!.n;const expected=this.db.query<{n:number},any[]>(`SELECT count(*) n FROM segments WHERE ${where}`).get(...args)!.n;return {range,label:this.rangeLabel(range),verses,total,omitted:total<expected};}
 search(query:string,translation:Translation,book?:number){this.edition(translation);const fts=literalFts(normalizeTorahSearch(query));if(!fts)return {verses:[],total:0,counts:new Map<number,number>()};const where='FROM verses_fts JOIN verses v ON v.id=verses_fts.rowid WHERE verses_fts MATCH ? AND v.translation=?';const counts=this.db.query<{book_id:number;n:number},any[]>(`SELECT v.book_id,count(*) n ${where} GROUP BY v.book_id`).all(fts,translation);const verses=this.db.query<Verse,any[]>(`SELECT v.id,v.translation,v.book_id,v.chapter,v.verse,v.text,v.notes ${where} ${book?'AND v.book_id=?':''} ORDER BY bm25(verses_fts),v.id LIMIT 400`).all(fts,translation,...(book?[book]:[]));return {verses,total:counts.filter(c=>!book||c.book_id===book).reduce((n,c)=>n+c.n,0),counts:new Map(counts.map(c=>[c.book_id,c.n]))};}
 crossReferences=BibleStore.prototype.crossReferences;
 saved(translation:Translation){return this.notes.query<VerseAddress,any[]>('SELECT book_id,chapter,verse FROM library_bookmarks WHERE library=? ORDER BY book_id,chapter,verse').all(this.library).flatMap(r=>this.verse(r.book_id,r.chapter,r.verse,translation)??this.verse(r.book_id,r.chapter,r.verse,translation==='english'?'original':'english')??[]);}
 isSaved(v:Verse){return !!this.notes.query('SELECT 1 FROM library_bookmarks WHERE library=? AND book_id=? AND chapter=? AND verse=?').get(this.library,v.book_id,v.chapter,v.verse);}
 toggleSaved(v:Verse){if(this.isSaved(v))this.notes.query('DELETE FROM library_bookmarks WHERE library=? AND book_id=? AND chapter=? AND verse=?').run(this.library,v.book_id,v.chapter,v.verse);else this.notes.query('INSERT INTO library_bookmarks VALUES(?,?,?,?)').run(this.library,v.book_id,v.chapter,v.verse);}
 sourcesFor(id:number):Source[]{return this.db.query<{json:string},any[]>('SELECT json FROM sources WHERE work=? ORDER BY edition').all(this.book(id).work).map(r=>JSON.parse(r.json));}
 coverageFor(id:number){return this.metadata.coverage[this.book(id).work];}
 bookGuide(id:number){const b=this.book(id);return {summary:b.summary,themes:this.library==='zohar'?['Creation','Soul','Light','Prayer']:['Prayer','Sabbath','Justice','Study'],highlights:[{label:'Beginning',chapter:1}]};}
 close(){this.links?.close();this.db.close();this.notes.close();}
}
