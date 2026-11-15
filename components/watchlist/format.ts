// Display helpers for the smart watchlist: label keys, number formats in the active language and the stale test.
// Nothing here computes a score or a rank; it only formats what the pipeline logged.

import type { FactorScores, SignalSet, Sourced } from '@/lib/domain/types';
import { formatDateTime, formatNumber, formatPercent } from '@/i18n/format';

export type FactorKey = keyof FactorScores;
export const FACTOR_KEYS: FactorKey[] = ['profile_fit', 'risk_fit', 'fundamentals', 'diversification'];

// Labels live in messages/<locale>/Watchlist.json; these helpers only pick the key.
export type Translate = (key: string, values?: Record<string, string | number>) => string;

const FILTER_KEYS = ['avoid_list', 'markets', 'volatility', 'market_cap_floor', 'liquidity', 'esg', 'novice', 'low_risk_etf', 'crypto_risk', 'data'];
const ASSET_CLASSES = ['stock', 'etf', 'crypto', 'gold', 'bond_yield'];
const ESG_TAGS = ['screened', 'not screened', 'controversy'];
const KEPT_KEYS = ['seed', 'incumbent', 'new'];
const RULE_IDS = ['momentum', 'news_flow', 'adanos_sentiment'];

export const factorLabel = (t: Translate, key: FactorKey) => t(`factors.long.${key}`);
export const factorShort = (t: Translate, key: FactorKey) => t(`factors.short.${key}`);
/** An id the service sent is shown translated when it is known, as received otherwise. */
export const filterLabel = (t: Translate, filter: string) => (FILTER_KEYS.includes(filter) ? t(`filters.${filter}`) : filter);
export const esgLabel = (t: Translate, tag: string) => (ESG_TAGS.includes(tag) ? t(`esg.${tag}`) : tag);
export const keptLabel = (t: Translate, kept: string) => (KEPT_KEYS.includes(kept) ? t(`kept.${kept}`) : kept);
export const ruleIdLabel = (t: Translate, id: string) => (RULE_IDS.includes(id) ? t(`ruleIds.${id}`) : id.replaceAll('_', ' '));
export const marketLabel = (t: Translate, market: string) => (market === 'US' || market === 'Canada' ? t(`market.${market}`) : market);

export type SignalKey = Exclude<keyof SignalSet, 'symbol' | 'entry' | 'missing'>;
// Display order of the inputs in the "Why?" panel and on the Expert card
export const SIGNAL_KEYS: SignalKey[] = [
    'price', 'changePercent', 'pe', 'revenueGrowthPct', 'volatility1y', 'beta', 'marketCapUsd',
    'avgDailyTradedValueUsd', 'sectorLabel', 'closes1m', 'newsCount7d',
];
export const signalLabel = (t: Translate, key: SignalKey) => t(`signals.${key}`);
/** Input names the service lists as missing: shown translated when they are known inputs. */
export const missingLabel = (t: Translate, key: string) => ((SIGNAL_KEYS as string[]).includes(key) ? t(`signals.${key}`) : key);
// Quotes go stale within seconds; the rest is collected once a day
const QUOTE_KEYS: SignalKey[] = ['price', 'changePercent'];

export const notAvailable = (t: Translate) => t('notAvailable');

export function compactUsd(value: number, t: Translate, locale: string): string {
    const abs = Math.abs(value);
    const [div, suffix] = abs >= 1e12 ? [1e12, 'T'] : abs >= 1e9 ? [1e9, 'B'] : abs >= 1e6 ? [1e6, 'M'] : [1, 'unit'];
    const digits = div === 1 ? 0 : 2;
    return t(`compact.${suffix}`, { value: formatNumber(value / div, locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }) });
}

/** A signed percentage such as +1.23% (en) or +1,23 % (fr). */
export function signedPct(value: number, locale: string, digits = 2): string {
    return formatPercent(value, locale, { signDisplay: 'exceptZero', minimumFractionDigits: digits, maximumFractionDigits: digits });
}

const fixed = (digits: number) => ({ minimumFractionDigits: digits, maximumFractionDigits: digits });

/** One input value as text, in the unit a reader expects and the active language. */
export function formatSignal(key: SignalKey, sourced: Sourced<unknown> | undefined, t: Translate, locale: string): string {
    if (!sourced || sourced.value == null) return notAvailable(t);
    const v = sourced.value;
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) return t('signalValue.closes', { count: v.length });
    if (typeof v !== 'number' || !Number.isFinite(v)) return notAvailable(t);
    switch (key) {
        case 'price': return sourced.unit === '%'
            ? formatPercent(v, locale, fixed(2))
            : `${formatNumber(v, locale, fixed(2))} ${sourced.currency ?? sourced.unit ?? ''}`.trim();
        case 'changePercent': return signedPct(v, locale);
        case 'revenueGrowthPct': return signedPct(v, locale, 1);
        case 'volatility1y': return formatPercent(v * 100, locale, fixed(1));
        case 'beta': return formatNumber(v, locale, fixed(2));
        case 'pe': return formatNumber(v, locale, fixed(1));
        case 'marketCapUsd': return compactUsd(v, t, locale);
        case 'avgDailyTradedValueUsd': return t('signalValue.perDay', { value: compactUsd(v, t, locale) });
        case 'newsCount7d': return t('signalValue.headlines', { count: v });
        default: return formatNumber(v, locale);
    }
}

/** A provider date such as 2026-11-13 is shown as a date; a full timestamp is shown in Québec time. */
export function formatTime(iso: string | undefined, t: Translate, locale: string): string {
    if (!iso) return notAvailable(t);
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return formatDateTime(`${iso}T00:00:00Z`, locale, { dateStyle: 'medium', timeZone: 'UTC' });
    return formatDateTime(iso, locale, { dateStyle: 'medium', timeStyle: 'medium' });
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
export function kindLabel(t: Translate, assetClass: string, sector?: string): string {
    const kind = ASSET_CLASSES.includes(assetClass) ? t(`assetClass.${assetClass}`) : assetClass;
    return sector ? t('kindLine', { kind, sector }) : kind;
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
