// Pure helpers of the Portfolio tab: number and time formats, the chart's period windows, the layout merge.

import type { Sourced } from '@/lib/domain/types';

export const money = (value: number) => value.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const signed = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${money(Math.abs(value))}`;
export const units = (value: number) => value.toLocaleString('en-CA', { maximumFractionDigits: 6 });
export const when = (iso: string) => {
    const date = new Date(iso);
    // A provider date with no time of day is shown as that date, not shifted by the viewer's time zone
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return date.toLocaleDateString('en-CA', { dateStyle: 'medium', timeZone: 'UTC' });
    // The zone is printed: a time with no zone cannot be checked against the source
    return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('en-CA', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
};

/** "Finnhub, as of Nov 13, 4:00 p.m." The provider's own time when it gives one, otherwise when we fetched it. */
export const sourceLine = (sourced: Pick<Sourced<unknown>, 'source' | 'asOf' | 'fetchedAt'>) =>
    `${sourced.source}, ${sourced.asOf ? `as of ${when(sourced.asOf)}` : `fetched ${when(sourced.fetchedAt)}`}`;

// Words the app never shows. A server message that carries one (a raw validation echo) is replaced.
const NEVER = /\b(buy|buying|sell|selling|should|good|safe|will rise|fits you|recommend\w*)\b/i;
export const hasNeverWord = (text: string) => NEVER.test(text);
export const safeMessage = (text: unknown, fallback = 'The request was not accepted.') =>
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

/** JSON call to the app's own API. Throws an Error whose message can be shown as it is. */
export async function api<T>(url: string, init?: { method: string; body?: unknown }): Promise<T> {
    const response = await fetch(url, {
        method: init?.method ?? 'GET',
        cache: 'no-store',
        ...(init?.body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(init.body) }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(safeMessage(body?.error ?? body?.message, `The request was not accepted (HTTP ${response.status}).`));
    return body as T;
}
