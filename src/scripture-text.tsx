import type { BoxRenderable } from '@opentui/core';
import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { hebrewDisplay, hebrewRendererError, type HebrewMarks } from './hebrew';
import type { Translation } from './store';
function usePaneWidth() {
  const ref = useRef<BoxRenderable>(null);
  const [width, setWidth] = useState(40);
  // Initial native layout is committed after React mounts the pane. Also remeasure
  // after panel changes; native resize hooks alone omit the initial geometry.
  useEffect(() => { const timer = setTimeout(() => { const size = Math.floor(ref.current?.width ?? 0); if (size > 0) setWidth(size); }, 20); return () => clearTimeout(timer); });
  return { ref, width, onSizeChange: function(this: BoxRenderable) { if (this.width > 0) setWidth(Math.floor(this.width)); } };
}
export const HebrewMarksContext = createContext<HebrewMarks>('full');
/** Measure the actual pane, wrap logical text, then apply Unicode bidi per line. */
export function ScriptureText({ text, translation, fg, maxHeight }: { text: string; translation?: Translation; fg: string; maxHeight?: number }) {
  const pane = usePaneWidth();
  const columns = pane.width;
  const marks = useContext(HebrewMarksContext);
  if (translation !== 'hebrew' && !/[\u0590-\u05ff]/u.test(text)) return <text fg={fg} maxHeight={maxHeight}>{text}</text>;
  const error = hebrewRendererError();
  return <box width="100%" minWidth={0} maxHeight={maxHeight} ref={pane.ref} onSizeChange={pane.onSizeChange}><text fg={fg} maxHeight={maxHeight}>{error ?? hebrewDisplay(text, columns, marks)}</text></box>;
}

export function BilingualText({ english, hebrew, fg, muted, englishLabel='JPS 1917', originalLabel='Hebrew' }: { english: string; hebrew: string; fg: string; muted: string; englishLabel?:string;originalLabel?:string }) {
  const pane = usePaneWidth();
  const width = pane.width;
  const wide = width >= 66;
  return <box width="100%" minWidth={0} flexDirection={wide ? 'row' : 'column'} gap={wide ? 3 : 1} ref={pane.ref} onSizeChange={pane.onSizeChange}>
    <box flexGrow={wide ? 1 : 0} flexBasis={wide ? 0 : undefined} minWidth={0}><text fg={muted}>{englishLabel}</text><ScriptureText text={english} translation="jps1917" fg={fg} /></box>
    <box flexGrow={wide ? 1 : 0} flexBasis={wide ? 0 : undefined} minWidth={0}><text fg={muted}>{originalLabel}</text><ScriptureText text={hebrew} translation={/[\u0590-\u05ff]/u.test(hebrew)?'hebrew':undefined} fg={fg} /></box>
  </box>;
}
