import { useState, type ReactNode } from 'react';
import type { BoxProps } from '@opentui/react';

export type Palette = { bg: string; panel: string; raised: string; fg: string; muted: string; line: string; accent: string; selected: string };
export const scrollIndicators = (p: Palette) => ({
  horizontalScrollbarOptions: { visible: false },
  verticalScrollbarOptions: { showArrows: false, trackOptions: { foregroundColor: p.line, backgroundColor: p.panel } },
});
type HoverBoxProps = Omit<BoxProps, 'children' | 'onMouseOver' | 'onMouseOut'> & {
  p: Palette; active?: boolean; disabled?: boolean; hoverBackground?: string; hoverBorder?: string;
  onHover?: (hovered: boolean) => void;
  children: ReactNode | ((hovered: boolean) => ReactNode);
};
export function HoverBox({ p, active = false, disabled = false, hoverBackground, hoverBorder, onHover, backgroundColor = p.panel, borderColor, children, ...props }: HoverBoxProps) {
  const [over, setOver] = useState(false);
  const hovered = over && !disabled;
  return <box {...props} onMouseDown={disabled ? undefined : props.onMouseDown}
    backgroundColor={hovered ? hoverBackground ?? (active ? p.line : p.raised) : backgroundColor}
    borderColor={hovered ? hoverBorder ?? borderColor : borderColor}
    onMouseOver={() => { setOver(true); onHover?.(true); }} onMouseOut={() => { setOver(false); onHover?.(false); }}>
    {typeof children === 'function' ? children(hovered) : children}
  </box>;
}
export function Action({ children, onPress, p, active = false, disabled = false, primary = false }: { children: ReactNode; onPress: () => void; p: Palette; active?: boolean; disabled?: boolean; primary?: boolean }) {
  return <HoverBox p={p} disabled={disabled} paddingX={1} height={1} flexShrink={0} backgroundColor={primary && !disabled ? p.accent : active ? p.selected : p.raised} hoverBackground={primary ? p.fg : p.accent} onMouseDown={event => { event.stopPropagation(); onPress(); }}>
    {hovered => <text fg={disabled ? p.muted : hovered || primary ? p.bg : active ? p.accent : p.fg}>{children}</text>}
  </HoverBox>;
}
