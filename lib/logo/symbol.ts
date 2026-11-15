// Shared by the logo route and the AssetLogo component: no server-only imports here.

import type { AssetClass } from '@/lib/domain/types';

const SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9.\-]{0,19}$/;

/** Upper-cased symbol, or null when it is not a plausible ticker (keeps odd strings out of URLs and file names). */
export function normalizeLogoSymbol(raw: string): string | null {
    let symbol: string;
    try {
        symbol = decodeURIComponent(raw).trim().toUpperCase();
    } catch {
        return null;
    }
    return SYMBOL_PATTERN.test(symbol) ? symbol : null;
}

/** Asset classes that never have a remote logo: the component draws their mark or icon without a request. */
export const CLASSES_WITHOUT_REMOTE_LOGO: ReadonlySet<AssetClass> = new Set<AssetClass>(['crypto', 'gold', 'bond_yield']);

/** Symbols with a mark drawn in the app (a letter in a circle, not the project's own logo file). */
export const BUILT_IN_MARKS: Record<string, { letter: string; tone: 'warn' | 'muted' }> = {
    BTC: { letter: 'B', tone: 'warn' },
    ETH: { letter: 'E', tone: 'muted' },
};

/** First letters of the ticker, without the exchange suffix: 'RY.TO' -> 'RY', 'BRK.B' -> 'BR'. */
export function monogram(symbol: string, letters = 2): string {
    const base = symbol.toUpperCase().replace(/\.TO$/, '').replace(/[^A-Z0-9]/g, '');
    return (base || symbol.toUpperCase()).slice(0, letters);
}
