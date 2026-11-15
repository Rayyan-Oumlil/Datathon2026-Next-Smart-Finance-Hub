// Fixed calculators over daily closes. Code computes; the agent only explains. Each result states its period,
// its method and where its inputs came from, so the number can be recomputed by hand.

import type { Sourced } from '@/lib/domain/types';
import type { DailyClose } from '@/lib/sources/types';
import { getEntry } from '@/lib/universe';
import { ServiceError } from './errors';
import { serviceRef } from './text';
import { dailyClosesFor } from './quotes';

export type StatPeriod = '1m' | '3m' | '1y';
export type StatMetric = 'return' | 'drawdown' | 'correlation';
export type Series = { symbol: string; closes: Sourced<DailyClose[]> };

export type StatResult = {
    metric: StatMetric;
    period: StatPeriod;
    symbols: string[];
    result: number | null;        // null: not enough data in the period; never a guess
    unit: '%' | 'coefficient';
    method: string;
    from?: string;                // first and last close dates actually used
    to?: string;
    observations: number;
    detail?: Record<string, unknown>;
    sources: Array<Sourced<string>>;
};

const MONTHS: Record<StatPeriod, number> = { '1m': 1, '3m': 3, '1y': 12 };
const MIN_RETURNS_FOR_CORRELATION = 20;
const round = (value: number, decimals: number) => Math.round((value + Number.EPSILON) * 10 ** decimals) / 10 ** decimals;

/** The closes of the period: from the same day N months before the last close, up to the last close. */
export function windowOf(closes: DailyClose[], period: StatPeriod): DailyClose[] {
    const rows = closes.filter((row) => Number.isFinite(row.close) && row.close > 0);
    if (rows.length === 0) return [];
    const from = new Date(`${rows[rows.length - 1].date}T00:00:00Z`);
    from.setUTCMonth(from.getUTCMonth() - MONTHS[period]);
    const start = from.toISOString().slice(0, 10);
    return rows.filter((row) => row.date >= start);
}

const sourceOf = ({ symbol, closes }: Series, used: DailyClose[]): Sourced<string> => ({
    value: used.length > 0 ? `${symbol}: ${used.length} daily closes, ${used[0].date} to ${used[used.length - 1].date}` : `${symbol}: no daily closes in the period`,
    unit: closes.currency,
    currency: closes.currency,
    source: closes.source,
    endpoint: closes.endpoint,
    fetchedAt: closes.fetchedAt,
    asOf: closes.asOf,
    note: closes.note,
});

/** Simple price return over the period, in %: last close / first close - 1. Dividends are not included. */
export function periodReturn(series: Series, period: StatPeriod): StatResult {
    const rows = windowOf(series.closes.value, period);
    const base = {
        metric: 'return' as const, period, symbols: [series.symbol], unit: '%' as const, observations: rows.length, sources: [sourceOf(series, rows)],
        method: `price return = (last close / first close - 1) x 100, over the daily closes of the last ${period}; dividends not included`,
    };
    if (rows.length < 2) return { ...base, result: null };
    const first = rows[0];
    const last = rows[rows.length - 1];
    return { ...base, result: round((last.close / first.close - 1) * 100, 2), from: first.date, to: last.date, detail: { firstClose: first.close, lastClose: last.close } };
}

/** Largest fall from a running peak to a later close within the period, in % (0 or negative). */
export function maxDrawdown(series: Series, period: StatPeriod): StatResult {
    const rows = windowOf(series.closes.value, period);
    const base = {
        metric: 'drawdown' as const, period, symbols: [series.symbol], unit: '%' as const, observations: rows.length, sources: [sourceOf(series, rows)],
        method: `maximum drawdown = the lowest value of (close / highest earlier close - 1) x 100, over the daily closes of the last ${period}`,
    };
    if (rows.length < 2) return { ...base, result: null };
    let peak = rows[0];
    let worst = 0;
    let detail = { peakDate: rows[0].date, peakClose: rows[0].close, troughDate: rows[0].date, troughClose: rows[0].close };
    for (const row of rows) {
        if (row.close > peak.close) peak = row;
        const fall = row.close / peak.close - 1;
        if (fall < worst) {
            worst = fall;
            detail = { peakDate: peak.date, peakClose: peak.close, troughDate: row.date, troughClose: row.close };
        }
    }
    return { ...base, result: round(worst * 100, 2), from: rows[0].date, to: rows[rows.length - 1].date, detail };
}

/** Pearson correlation of the simple daily returns of two series, over the dates both have in the period. */
export function correlation(a: Series, b: Series, period: StatPeriod): StatResult {
    const rowsA = windowOf(a.closes.value, period);
    const inB = new Map(windowOf(b.closes.value, period).map((row) => [row.date, row.close]));
    const common = rowsA.filter((row) => inB.has(row.date));
    const usedB = common.map((row) => ({ date: row.date, close: inB.get(row.date)! }));
    const returns = (rows: DailyClose[]) => rows.slice(1).map((row, i) => row.close / rows[i].close - 1);
    const x = returns(common);
    const y = returns(usedB);
    const base = {
        metric: 'correlation' as const, period, symbols: [a.symbol, b.symbol], unit: 'coefficient' as const, observations: x.length,
        sources: [sourceOf(a, common), sourceOf(b, usedB)],
        method: `Pearson correlation of simple daily returns over the dates both series have in the last ${period}; at least ${MIN_RETURNS_FOR_CORRELATION} returns needed`,
    };
    if (x.length < MIN_RETURNS_FOR_CORRELATION) return { ...base, result: null };
    const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
    const mx = mean(x);
    const my = mean(y);
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < x.length; i++) {
        sxy += (x[i] - mx) * (y[i] - my);
        sxx += (x[i] - mx) ** 2;
        syy += (y[i] - my) ** 2;
    }
    // A series that never moved has no correlation to report
    if (sxx === 0 || syy === 0) return { ...base, result: null };
    return { ...base, result: round(sxy / Math.sqrt(sxx * syy), 4), from: common[0].date, to: common[common.length - 1].date };
}

/** Fetches the daily closes and runs one calculator. Return and drawdown take one symbol, correlation two. */
export async function computeStat(input: { metric: StatMetric; symbols: string[]; period: StatPeriod }): Promise<StatResult> {
    const wanted = input.metric === 'correlation' ? 2 : 1;
    if (input.symbols.length !== wanted) throw new ServiceError(400, serviceRef('svc.stats.symbols_needed', { metric: input.metric, count: wanted }));
    const series = await Promise.all(input.symbols.map(async (symbol): Promise<Series> => {
        const entry = getEntry(symbol);
        if (!entry) throw new ServiceError(404, serviceRef('svc.not_in_universe', { symbol }));
        const closes = await dailyClosesFor(entry).catch(() => null);
        if (!closes) throw new ServiceError(502, serviceRef('svc.stats.no_closes', { symbol: entry.symbol }));
        return { symbol: entry.symbol, closes };
    }));
    if (input.metric === 'return') return periodReturn(series[0], input.period);
    if (input.metric === 'drawdown') return maxDrawdown(series[0], input.period);
    return correlation(series[0], series[1], input.period);
}
