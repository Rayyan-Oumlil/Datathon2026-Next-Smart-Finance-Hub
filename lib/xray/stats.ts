// Fixed calculators on aligned daily returns. Pure: no I/O, no clock. Every formula is the one written in the
// design (sample statistics, 252 trading days a year).

import type { Drawdown } from './types';

export const TRADING_DAYS = 252;
export const round = (value: number, decimals: number) => Math.round((value + Number.EPSILON) * 10 ** decimals) / 10 ** decimals;

export const mean = (x: number[]) => x.reduce((sum, v) => sum + v, 0) / x.length;

/** Sample covariance (n - 1). NaN with fewer than two points. */
export function sampleCov(x: number[], y: number[]): number {
    const n = Math.min(x.length, y.length);
    if (n < 2) return NaN;
    const mx = mean(x.slice(0, n));
    const my = mean(y.slice(0, n));
    let sum = 0;
    for (let i = 0; i < n; i++) sum += (x[i] - mx) * (y[i] - my);
    return sum / (n - 1);
}

export const sampleStdev = (x: number[]) => Math.sqrt(sampleCov(x, x));

/** Pearson correlation; null when either series never moved. */
export function correlationOf(x: number[], y: number[]): number | null {
    const sx = sampleStdev(x);
    const sy = sampleStdev(y);
    if (!(sx > 0) || !(sy > 0)) return null;
    return sampleCov(x, y) / (sx * sy);
}

/** Simple returns between consecutive levels. */
export const returnsOf = (levels: number[]): number[] => levels.slice(1).map((level, i) => level / levels[i] - 1);

/** Annualised volatility in percent. */
export const annualVolPct = (dailyReturns: number[]): number => sampleStdev(dailyReturns) * Math.sqrt(TRADING_DAYS) * 100;

/** Level of 100 at dates[0], then compounded by the daily returns (dates has one more entry than returns). */
export function curveOf(dates: string[], dailyReturns: number[]): Array<{ date: string; value: number }> {
    const curve = [{ date: dates[0], value: 100 }];
    dailyReturns.forEach((r, i) => curve.push({ date: dates[i + 1], value: curve[i].value * (1 + r) }));
    return curve;
}

/** The deepest fall from a running peak to a later point, with its dates and the date it was regained (or null). */
export function maxDrawdownOf(curve: Array<{ date: string; value: number }>): Drawdown {
    let peak = curve[0];
    let worst = 0;
    let peakAtWorst = curve[0];
    let troughIndex = 0;
    curve.forEach((point, i) => {
        if (point.value > peak.value) peak = point;
        const fall = point.value / peak.value - 1;
        if (fall < worst) {
            worst = fall;
            peakAtWorst = peak;
            troughIndex = i;
        }
    });
    const recovered = worst < 0 ? curve.slice(troughIndex + 1).find((point) => point.value >= peakAtWorst.value) : undefined;
    return {
        pct: round(worst * 100, 2),
        peakDate: peakAtWorst.date,
        troughDate: curve[troughIndex].date,
        recoveredDate: recovered?.date ?? null,
    };
}

/** The lowest compounded return over any `span` consecutive trading days; null when the series is shorter. */
export function worstSpanOf(curve: Array<{ date: string; value: number }>, span: number): { pct: number; from: string; to: string } | null {
    if (curve.length <= span) return null;
    let best = { change: Infinity, from: '', to: '' };
    for (let i = span; i < curve.length; i++) {
        const change = curve[i].value / curve[i - span].value - 1;
        if (change < best.change) best = { change, from: curve[i - span].date, to: curve[i].date };
    }
    return { pct: round(best.change * 100, 2), from: best.from, to: best.to };
}

export function worstDayOf(dates: string[], dailyReturns: number[]): { pct: number; date: string } {
    let at = 0;
    dailyReturns.forEach((r, i) => {
        if (r < dailyReturns[at]) at = i;
    });
    return { pct: round(dailyReturns[at] * 100, 2), date: dates[at + 1] };
}

/**
 * Each holding's share of the portfolio's variance: w_i x cov(r_i, r_p) / var(r_p). The shares add up to 100 %
 * (Euler decomposition). Null for every holding when the portfolio never moved.
 */
export function riskShares(weights: number[], returns: number[][], portfolioReturns: number[]): Array<number | null> {
    const variance = sampleCov(portfolioReturns, portfolioReturns);
    if (!(variance > 0)) return weights.map(() => null);
    return weights.map((w, i) => (w * sampleCov(returns[i], portfolioReturns)) / variance * 100);
}

/** sum(w_i x sigma_i) / sigma_p: 1 means no diversification benefit; null when the portfolio never moved. */
export function diversificationRatio(weights: number[], returns: number[][], portfolioReturns: number[]): number | null {
    const sigmaP = sampleStdev(portfolioReturns);
    if (!(sigmaP > 0)) return null;
    return weights.reduce((sum, w, i) => sum + w * sampleStdev(returns[i]), 0) / sigmaP;
}

/** The highest pairwise correlations among the holdings, highest first. */
export function topPairs(symbols: string[], returns: number[][], count: number): Array<{ a: string; b: string; correlation: number }> {
    const pairs: Array<{ a: string; b: string; correlation: number }> = [];
    for (let i = 0; i < symbols.length; i++) {
        for (let j = i + 1; j < symbols.length; j++) {
            const correlation = correlationOf(returns[i], returns[j]);
            if (correlation !== null) pairs.push({ a: symbols[i], b: symbols[j], correlation: round(correlation, 4) });
        }
    }
    return pairs.sort((p, q) => q.correlation - p.correlation).slice(0, count);
}

/** At most `max` points for a chart: an even stride, always keeping the ends and the dates in `keep`. */
export function thin<T extends { date: string }>(points: T[], max: number, keep: string[]): T[] {
    if (points.length <= max) return points;
    const stride = Math.ceil(points.length / max);
    const kept = new Set(keep);
    return points.filter((point, i) => i === 0 || i === points.length - 1 || i % stride === 0 || kept.has(point.date));
}
