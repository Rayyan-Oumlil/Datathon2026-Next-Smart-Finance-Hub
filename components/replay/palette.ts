import type { CSSProperties } from 'react';

// Five series colours for the comparison chart, derived from the theme tokens (so they follow light and dark mode).
// Scoped to the comparison's root element as local custom properties; none of them is the "up" green or the
// "down" red, so no line reads as better or worse.
export const SERIES_VARS: CSSProperties = {
    '--cmp-0': 'var(--brand)',
    '--cmp-1': 'oklch(from var(--brand) l calc(c * 0.75) calc(h + 220))',
    '--cmp-2': 'var(--warn)',
    '--cmp-3': 'oklch(from var(--up) l c calc(h + 45))',
    '--cmp-4': 'oklch(from var(--brand) l calc(c * 0.7) calc(h + 275))',
} as CSSProperties;

export const SERIES_COUNT = 5;
export const seriesColor = (slot: number) => `var(--cmp-${((slot % SERIES_COUNT) + SERIES_COUNT) % SERIES_COUNT})`;
