/**
 * The replay's common calendar (pure). TSX and U.S. holidays differ and crypto trades every day, so the engine
 * needs one list of dates to step through. We use every day on which at least one TSX or U.S. asset trades
 * (union): a portfolio holding both markets changes value on those days. Assets whose market is closed keep
 * their last close (series.ts); crypto is carried onto these dates and its weekend rows are not dates of their own.
 */

import type { AssetClass, IsoDate } from './types';

export type MarketGroup = 'TSX' | 'US' | 'crypto';

/** Groups the organizers' market labels: crypto by class, '.TO' listings on the TSX, everything else U.S. */
export function marketGroup(asset: { assetClass: AssetClass; market: string }): MarketGroup {
    if (asset.assetClass === 'crypto') return 'crypto';
    return asset.market === 'TSX' ? 'TSX' : 'US';
}

export type CalendarInput = {
    assets: ReadonlyArray<{ ticker: string; assetClass: AssetClass; market: string }>;
    prices: ReadonlyArray<{ id: string; rows: ReadonlyArray<{ date: IsoDate }> }>;
};

/** Sorted distinct trading dates per market group. */
export function tradingDatesByGroup(input: CalendarInput): Record<MarketGroup, IsoDate[]> {
    const groupOf = new Map(input.assets.map((a) => [a.ticker, marketGroup(a)]));
    const sets: Record<MarketGroup, Set<IsoDate>> = { TSX: new Set(), US: new Set(), crypto: new Set() };
    for (const t of input.prices) {
        const g = groupOf.get(t.id);
        if (!g) throw new Error(`no asset for price table ${t.id}`);
        for (const r of t.rows) sets[g].add(r.date);
    }
    const sorted = (s: Set<IsoDate>) => [...s].sort();
    return { TSX: sorted(sets.TSX), US: sorted(sets.US), crypto: sorted(sets.crypto) };
}

/**
 * The common calendar: 'union' (default) of TSX and U.S. trading dates, or 'intersection' (days both trade).
 * Crypto never adds dates.
 */
export function buildCommonCalendar(input: CalendarInput, mode: 'union' | 'intersection' = 'union'): IsoDate[] {
    const { TSX, US } = tradingDatesByGroup(input);
    if (mode === 'intersection') {
        const us = new Set(US);
        return TSX.filter((d) => us.has(d));
    }
    return [...new Set([...TSX, ...US])].sort();
}

/** Calendar dates in [from, to], both inclusive and optional. */
export function sliceCalendar(calendar: readonly IsoDate[], from?: IsoDate, to?: IsoDate): IsoDate[] {
    return calendar.filter((d) => (from === undefined || d >= from) && (to === undefined || d <= to));
}

/** First calendar date on or after `date` (where a replay starting on a holiday actually starts). */
export function nextCalendarDate(calendar: readonly IsoDate[], date: IsoDate): IsoDate | undefined {
    return calendar.find((d) => d >= date);
}
