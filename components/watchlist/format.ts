// Display helpers for the smart watchlist: plain-word labels, number formats and the stale test.
// Nothing here computes a score or a rank; it only formats what the pipeline logged.

import type { FactorScores, FilterCheck, SignalSet, Sourced } from '@/lib/domain/types';

export type FactorKey = keyof FactorScores;
export const FACTOR_KEYS: FactorKey[] = ['profile_fit', 'risk_fit', 'fundamentals', 'diversification'];

export const FACTOR_LABEL: Record<FactorKey, string> = {
    profile_fit: 'Match with your profile choices',
    risk_fit: 'Volatility against your risk band',
    fundamentals: 'Fundamentals (P/E and growth)',
    diversification: 'Diversification of your holdings',
};
export const FACTOR_SHORT: Record<FactorKey, string> = {
    profile_fit: 'Profile match',
    risk_fit: 'Risk band',
    fundamentals: 'Fundamentals',
    diversification: 'Diversification',
};

export const FILTER_LABEL: Record<FilterCheck['filter'], string> = {
    avoid_list: 'Avoid list',
    markets: 'Markets picked',
    volatility: 'Volatility cap',
    market_cap_floor: 'Market cap floor',
    liquidity: 'Traded value per day',
    esg: 'ESG tag (demo data)',
    novice: 'Novice rule',
    low_risk_etf: 'Low-risk ETF rule',
    crypto_risk: 'Crypto rule',
    data: 'Data needed by the filters',
};

export const ASSET_CLASS_LABEL: Record<string, string> = {
    stock: 'Stock',
    etf: 'ETF',
    crypto: 'Crypto',
    gold: 'Gold',
    bond_yield: 'Bond yield',
};

export type SignalKey = Exclude<keyof SignalSet, 'symbol' | 'entry' | 'missing'>;
// Display order of the inputs in the "Why?" panel and on the Expert card
export const SIGNAL_KEYS: SignalKey[] = [
    'price', 'changePercent', 'pe', 'revenueGrowthPct', 'volatility1y', 'beta', 'marketCapUsd',
    'avgDailyTradedValueUsd', 'sectorLabel', 'closes1m', 'newsCount7d',
];
export const SIGNAL_LABEL: Record<SignalKey, string> = {
    price: 'Last price',
    changePercent: 'Move today',
    pe: 'P/E (trailing 12 months)',
    revenueGrowthPct: 'Revenue growth, year over year',
    volatility1y: 'Volatility, 1 year',
    beta: 'Beta',
    marketCapUsd: 'Market cap',
    avgDailyTradedValueUsd: 'Traded value per day',
    sectorLabel: 'Industry label from the provider (not GICS)',
    closes1m: 'Daily closes, 1 month',
    newsCount7d: 'Headlines, 7 days (shown, never scored)',
};
// Quotes go stale within seconds; the rest is collected once a day
const QUOTE_KEYS: SignalKey[] = ['price', 'changePercent'];

export const NOT_AVAILABLE = 'not available';

export function compactUsd(value: number): string {
    const abs = Math.abs(value);
    const [div, suffix] = abs >= 1e12 ? [1e12, 'T'] : abs >= 1e9 ? [1e9, 'B'] : abs >= 1e6 ? [1e6, 'M'] : [1, ''];
    return `US$${(value / div).toFixed(div === 1 ? 0 : 2)}${suffix}`;
}

export function signedPct(value: number, digits = 2): string {
    return `${value > 0 ? '+' : ''}${value.toFixed(digits)}%`;
}

/** One input value as text, in the unit a reader expects. */
export function formatSignal(key: SignalKey, sourced: Sourced<unknown> | undefined): string {
    if (!sourced || sourced.value == null) return NOT_AVAILABLE;
    const v = sourced.value;
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) return `${v.length} daily closes`;
    if (typeof v !== 'number' || !Number.isFinite(v)) return NOT_AVAILABLE;
    switch (key) {
        case 'price': return sourced.unit === '%' ? `${v.toFixed(2)}%` : `${v.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${sourced.currency ?? sourced.unit ?? ''}`.trim();
        case 'changePercent': return signedPct(v);
        case 'revenueGrowthPct': return signedPct(v, 1);
        case 'volatility1y': return `${(v * 100).toFixed(1)}%`;
        case 'beta': return v.toFixed(2);
        case 'pe': return v.toFixed(1);
        case 'marketCapUsd': return compactUsd(v);
        case 'avgDailyTradedValueUsd': return `${compactUsd(v)} a day`;
        case 'newsCount7d': return `${v} headlines`;
        default: return String(v);
    }
}

/** A provider date such as 2026-11-13 is shown as given; a full timestamp is shown in the reader's time zone. */
export function formatTime(iso: string | undefined): string {
    if (!iso) return NOT_AVAILABLE;
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleString('en-CA', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

const localDay = (date: Date) => `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;

/**
 * Stale = fetched more than `quoteSeconds` ago for a quote, or before today (reader's calendar day) for a
 * value collected once a day. A fetch time that cannot be read counts as stale.
 */
export function isStale(key: SignalKey, sourced: Pick<Sourced<unknown>, 'fetchedAt'>, quoteSeconds: number, now: Date = new Date()): boolean {
    const fetched = new Date(sourced.fetchedAt);
    if (Number.isNaN(fetched.getTime())) return true;
    if (QUOTE_KEYS.includes(key)) return now.getTime() - fetched.getTime() > quoteSeconds * 1000;
    return localDay(fetched) !== localDay(now) && fetched.getTime() < now.getTime();
}

export function staleSummary(signals: SignalSet, quoteSeconds: number, now: Date = new Date()): { quote: boolean; daily: boolean } {
    const stale = (keys: SignalKey[]) => keys.some((key) => {
        const sourced = signals[key] as Sourced<unknown> | undefined;
        return sourced ? isStale(key, sourced, quoteSeconds, now) : false;
    });
    return { quote: stale(QUOTE_KEYS), daily: stale(SIGNAL_KEYS.filter((key) => !QUOTE_KEYS.includes(key))) };
}

/** Type or sector line of a card: the sector for a stock, the asset class otherwise. */
export function kindLabel(assetClass: string, sector?: string): string {
    const kind = ASSET_CLASS_LABEL[assetClass] ?? assetClass;
    return sector ? `${kind} · ${sector}` : kind;
}

/** The rule values the UI states or explains, read from rules/v1.json on the server and passed down. */
export type WatchlistRulesView = {
    scoreVersion: string;
    weights: Record<FactorKey, number>;
    totalFormula: string;
    factors: Record<FactorKey, { meaning: string; formula: string }>;
    removedFromScore: string[];
    neverAnInput: string[];
    topN: Record<string, number>;
    maxPerSector: number;
    maxCrypto: number;
    quoteStaleSeconds: number;
    reasonTemplates: Array<{ id: string; text: string; source: string }>;
};
