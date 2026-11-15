// Pure helpers of the Portfolio tab: number and time formats, the chart's period windows, the layout merge.

import type { Sourced } from '@/lib/domain/types';
import { formatDateTime, formatNumber, formatPercent } from '@/i18n/format';

/** A next-intl translator, narrowed to what these helpers call. */
export type Translate = (key: string, values?: Record<string, string | number>) => string;

// Every number and date below is formatted for the active language through the i18n helpers (never by hand).
const TWO = { minimumFractionDigits: 2, maximumFractionDigits: 2 } as const;
const NBSP = '\u00a0';

export const money = (value: number, locale: string) => formatNumber(value, locale, TWO);
export const signed = (value: number, locale: string) => formatNumber(value, locale, { ...TWO, signDisplay: 'exceptZero' });
export const units = (value: number, locale: string) => formatNumber(value, locale, { maximumFractionDigits: 6 });
/** An amount in Canadian dollars, the currency code kept so the figure can be checked against its source. */
export const cad = (value: number, locale: string) => `${money(value, locale)}${NBSP}CAD`;
export const signedCad = (value: number, locale: string) => `${signed(value, locale)}${NBSP}CAD`;
/** A value already in percent, one decimal: 12.5 -> "12.5%" / "12,5 %". */
export const share = (value: number, locale: string) => formatPercent(value, locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
/** A signed percent, two decimals: 2.5 -> "+2.50%" / "+2,50 %". */
export const signedPct = (value: number, locale: string) => formatPercent(value, locale, { ...TWO, signDisplay: 'exceptZero' });

export const when = (iso: string, locale: string) => {
    // A provider date with no time of day is shown as that date, not shifted by a time zone
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return formatDateTime(iso, locale, { dateStyle: 'medium', timeZone: 'UTC' });
    // The zone is printed: a time with no zone cannot be checked against the source
    return formatDateTime(iso, locale, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
};

/** "Finnhub, as of Nov 13, 4:00 p.m." The provider's own time when it gives one, otherwise when we fetched it. */
export const sourceLine = (sourced: Pick<Sourced<unknown>, 'source' | 'asOf' | 'fetchedAt'>, locale: string, t: Translate) =>
    sourced.asOf
        ? t('sourceLine.asOf', { source: sourced.source, when: when(sourced.asOf, locale) })
        : t('sourceLine.fetched', { source: sourced.source, when: when(sourced.fetchedAt, locale) });

// Words the app never shows, in English and French. A server message that carries one (a raw validation echo) is replaced.
const NEVER_WORDS = [
    'buy', 'buying', 'sell', 'selling', 'should', 'good', 'safe', 'will rise', 'fits you', 'recommend\\w*',
    'acheter', 'achetez', 'vendre', 'vendez', 'devriez', 'devrait', 'devraient', 'il faut', 'bon', 'bonne', 'bons', 'bonnes',
    'sûre?s?', 's[eé]curitaires?', 'sans risque', 'va monter', 'va augmenter', 'vous conviennent?',
    'recommand[eé]\\w*', 'conseill[eé]\\w*',
];
const NEVER = new RegExp(`(?<![\\p{L}\\p{N}])(?:${NEVER_WORDS.map((word) => word.replace(/ /g, '[\\s\\u00a0]+')).join('|')})(?![\\p{L}\\p{N}])`, 'iu');
export const hasNeverWord = (text: string) => NEVER.test(text);
/** A server message that is safe to show as received, otherwise the fallback ('' lets the caller choose its own words). */
export const safeMessage = (text: unknown, fallback = '') =>
    typeof text === 'string' && text.length > 0 && !hasNeverWord(text) ? text : fallback;

// ---------------------------------------------------------------- chart periods

export const PERIODS = ['1D', '1W', '1M', '1Y', 'All'] as const;
export type Period = (typeof PERIODS)[number];
export type HistoryPoint = { t: string; valueCad: number };

const DAY = 24 * 60 * 60 * 1000;
const SPAN: Record<Exclude<Period, 'All'>, number> = { '1D': DAY, '1W': 7 * DAY, '1M': 31 * DAY, '1Y': 366 * DAY };

/** The points of the series inside the period ending now, in time order. Fewer than two means nothing to draw. */
export function pointsFor(history: HistoryPoint[], period: Period, now: number): HistoryPoint[] {
    const sorted = history.filter((point) => Number.isFinite(Date.parse(point.t)) && Number.isFinite(point.valueCad))
        .sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
    return period === 'All' ? sorted : sorted.filter((point) => Date.parse(point.t) >= now - SPAN[period]);
}

/** Maps points to a 0-1 box (x by time, y by value, 0 at the top). The baseline is always inside the box. */
export function chartBox(points: HistoryPoint[], baseline: number) {
    const times = points.map((point) => Date.parse(point.t));
    const values = [...points.map((point) => point.valueCad), baseline];
    const t0 = Math.min(...times);
    const span = Math.max(...times) - t0 || 1;
    let low = Math.min(...values);
    let high = Math.max(...values);
    // A flat series still needs a height
    const pad = (high - low || Math.abs(high) * 0.01 || 1) * 0.12;
    low -= pad;
    high += pad;
    const y = (value: number) => (high - value) / (high - low);
    return { low, high, baselineY: y(baseline), dots: points.map((point, index) => ({ x: (times[index] - t0) / span, y: y(point.valueCad), point })) };
}

// ---------------------------------------------------------------- layout

/** The modules this tab draws. 'price_alerts' is in the library but has no module here. */
export const PORTFOLIO_MODULES = ['total_value', 'performance', 'holdings', 'sector_allocation', 'investment_rules'] as const;
export type ModuleId = (typeof PORTFOLIO_MODULES)[number];
const isModule = (id: string): id is ModuleId => (PORTFOLIO_MODULES as readonly string[]).includes(id);

/** The saved layout narrowed to this tab's modules, in saved order. */
export const modulesOf = (layout: string[]): ModuleId[] => layout.filter(isModule);

/** The full layout to save: this tab's new order first, every other saved id (the Overview tab's) kept as it was. */
export const mergeLayout = (layout: string[], order: ModuleId[]): string[] => [...order, ...layout.filter((id) => !isModule(id))];

/** Moves one module a step. A fixed module keeps its place, so nothing swaps with it. */
export function moveModule(order: ModuleId[], id: ModuleId, step: -1 | 1, fixed: ReadonlySet<string>): ModuleId[] {
    const from = order.indexOf(id);
    const to = from + step;
    if (from < 0 || to < 0 || to >= order.length || fixed.has(id) || fixed.has(order[to])) return order;
    const next = [...order];
    [next[from], next[to]] = [next[to], next[from]];
    return next;
}

// ---------------------------------------------------------------- fetch

/** A failed call. The message is the server's own wording when it can be shown, otherwise empty (see errorText). */
export class ApiError extends Error {
    constructor(message: string, readonly status: number) {
        super(message);
    }
}

/** What to show for a failed call: the server's message as received, or a translated generic sentence. */
export const errorText = (failure: unknown, t: Translate): string => {
    if (failure instanceof ApiError) {
        if (failure.message) return failure.message;
        return failure.status > 0 ? t('errors.notAcceptedHttp', { status: failure.status }) : t('errors.network');
    }
    return failure instanceof Error && failure.message ? failure.message : t('errors.notAccepted');
};

/** JSON call to the app's own API. Throws an ApiError; show it with errorText. */
export async function api<T>(url: string, init?: { method: string; body?: unknown }): Promise<T> {
    let response: Response;
    try {
        response = await fetch(url, {
            method: init?.method ?? 'GET',
            cache: 'no-store',
            ...(init?.body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(init.body) }),
        });
    } catch {
        throw new ApiError('', 0);
    }
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new ApiError(safeMessage(body?.error ?? body?.message), response.status);
    return body as T;
}
