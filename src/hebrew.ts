import { dlopen, ptr } from 'bun:ffi';
import { stringWidth } from 'bun';

// FriBidi implements the Unicode bidi algorithm, including numbers, mirrored
// punctuation and combining marks. Only display lines are reordered; stored
// text, searching, copying and references remain in logical Unicode order.
const signature = { fribidi_log2vis: { args: ['ptr', 'i32', 'ptr', 'ptr', 'ptr', 'ptr', 'ptr'], returns: 'u8' } } as const;
let library: ReturnType<typeof open> | undefined;
function open() { return dlopen('libfribidi.so.0', signature); }
export function hebrewRendererError(): string | null {
  try { library ??= open(); return null; }
  catch { return 'Hebrew display needs the system FriBidi library (libfribidi.so.0). English reading is available.'; }
}
const segmenter = new Intl.Segmenter('he', { granularity: 'grapheme' });
export type HebrewMarks = 'full' | 'vowels' | 'plain';
export function withHebrewMarks(text: string, marks: HebrewMarks) {
  if (marks === 'plain') return text.replace(/[\u0591-\u05bd\u05bf\u05c1\u05c2\u05c4\u05c5\u05c7]/gu, '');
  if (marks === 'vowels') return text.replace(/[\u0591-\u05af]/gu, '');
  return text;
}
export function wrapLogical(text: string, width: number): string[] {
  width = Math.max(1, Math.floor(width));
  const lines: string[] = [];
  let current = '';
  for (const word of text.trim().split(/\s+/u)) {
    if (current && stringWidth(`${current} ${word}`) <= width) { current += ` ${word}`; continue; }
    if (current) { lines.push(current); current = ''; }
    for (const { segment } of segmenter.segment(word)) {
      if (current && stringWidth(current + segment) > width) { lines.push(current); current = ''; }
      current += segment;
    }
  }
  if (current) lines.push(current);
  return lines;
}
export function visualHebrewLine(text: string) {
  const error = hebrewRendererError(); if (error) throw new Error(error);
  if (!text) return '';
  const input = new Uint32Array(Array.from(text, char => char.codePointAt(0)!));
  const output = new Uint32Array(input.length), direction = new Uint32Array([0x111]); // FRIBIDI_PAR_RTL
  if (!library!.symbols.fribidi_log2vis(ptr(input), input.length, ptr(direction), ptr(output), null, null, null)) throw new Error('Hebrew layout failed.');
  return String.fromCodePoint(...output).replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, '');
}
const cache = new Map<string, string>();
export function hebrewDisplay(text: string, width: number, marks: HebrewMarks = 'full') {
  width = Math.max(1, Math.floor(width));
  const key = `${width}:${marks}:${text}`;
  const previous = cache.get(key); if (previous !== undefined) return previous;
  const display = withHebrewMarks(text, marks).split('\n').flatMap(paragraph => paragraph.trim() ? wrapLogical(paragraph, width) : ['']).map(line => {
    const visual = visualHebrewLine(line);
    return ' '.repeat(Math.max(0, width - stringWidth(visual))) + visual;
  }).join('\n');
  if (cache.size >= 2000) cache.clear(); cache.set(key, display);
  return display;
}
