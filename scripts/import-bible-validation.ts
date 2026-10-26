export type Corpus = { books: { book: string; bookId: number; englishName: string; testament: string; chapters: { chapter: number; verses: { number: number; text: string }[] }[] }[] };
export function verifiedCorpus(raw: string, expected: {sha256: string; verses: number; translation: string}): Corpus {
  const actual = new Bun.CryptoHasher('sha256').update(raw).digest('hex');
  if (actual !== expected.sha256) throw new Error(`${expected.translation} source checksum changed. Existing data is intact; review the source before updating the manifest.`);
  const corpus = JSON.parse(raw) as Corpus;
  if (corpus.books.length !== 66) throw new Error('Expected the 66-book Bible corpus.');
  let count = 0;
  for (const [i, book] of corpus.books.entries()) {
    if (book.bookId !== i + 1 || !book.book || !book.englishName || !['OT','NT'].includes(book.testament) || !book.chapters.length) throw new Error('Invalid book metadata.');
    for (const [j, chapter] of book.chapters.entries()) {
      if (chapter.chapter !== j + 1 || !chapter.verses.length) throw new Error('Invalid chapter sequence.');
      let previous = 0;
      for (const verse of chapter.verses) {
        if (!Number.isInteger(verse.number) || verse.number <= previous || verse.number >= 1000 || typeof verse.text !== 'string' || !verse.text.trim() || /[\x00-\x08\x0b-\x1f\x7f-\x9f]/.test(verse.text)) throw new Error('Invalid verse text or numbering.');
        previous = verse.number; count++;
      }
    }
  }
  if (count !== expected.verses) throw new Error(`Unexpected ${expected.translation} verse count: ${count}.`);
  return corpus;
}
