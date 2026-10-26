export type VerseAddress = { book_id: number; chapter: number; verse: number };
export type PassageRange = { start: VerseAddress; end: VerseAddress };
export const addressKey = (ref: VerseAddress) => ref.book_id * 1_000_000 + ref.chapter * 1000 + ref.verse;
export const decodeAddress = (key: number): VerseAddress => ({ book_id: Math.floor(key / 1_000_000), chapter: Math.floor(key % 1_000_000 / 1000), verse: key % 1000 });
export const singleVerse = (ref: VerseAddress): PassageRange => ({ start: { book_id: ref.book_id, chapter: ref.chapter, verse: ref.verse }, end: { book_id: ref.book_id, chapter: ref.chapter, verse: ref.verse } });
export const rangeKey = (range: PassageRange) => `${addressKey(range.start)}-${addressKey(range.end)}`;
export const containsVerse = (range: PassageRange, ref: VerseAddress) => addressKey(range.start) <= addressKey(ref) && addressKey(ref) <= addressKey(range.end);
