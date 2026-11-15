// Independent check of the engine (documented in the technical document): the same statistics recomputed another
// way, from the same closes, with seeded random data. The engine uses an Euler decomposition and a running peak;
// here the portfolio variance is the full quadratic form w'Sw and the drawdown is a brute-force search over all pairs.

import { describe, expect, it } from 'vitest';
import { computeEngine } from '@/lib/xray/engine';
import type { EngineHolding } from '@/lib/xray/types';

// A small seeded generator (mulberry32) and a normal draw (Box-Muller): the same data on every run
function rng(seed: number) {
    let a = seed;
    const uniform = () => {
        a |= 0; a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return () => Math.sqrt(-2 * Math.log(uniform() || 1e-12)) * Math.cos(2 * Math.PI * uniform());
}

const DAY = 24 * 60 * 60 * 1000;
const END = Date.parse('2026-11-13T00:00:00Z');
const dates = (() => {
    const out: string[] = [];
    for (let ms = END; out.length < 400; ms -= DAY) {
        const d = new Date(ms).getUTCDay();
        if (d !== 0 && d !== 6) out.unshift(new Date(ms).toISOString().slice(0, 10));
    }
    return out;
})();

function holding(symbol: string, valueCad: number, seed: number, vol: number, common: number[], beta: number): EngineHolding {
    const noise = rng(seed);
    let level = 100;
    const closes = dates.map((date, i) => {
        if (i > 0) level *= 1 + beta * common[i - 1] + vol * noise();
        return { date, close: level };
    });
    return { symbol, name: symbol, group: 'G', assetClass: 'stock', currency: 'CAD', valueCad, isCrypto: false, closes };
}

const marketNoise = rng(7);
const common = Array.from({ length: dates.length - 1 }, () => 0.006 * marketNoise());
const HOLDINGS = [
    holding('A', 4000, 1, 0.012, common, 1.0),
    holding('B', 2500, 2, 0.02, common, 1.4),
    holding('C', 1500, 3, 0.008, common, 0.4),
    holding('D', 1000, 4, 0.03, common, 0.1),
];
const CASH = 1000;
const TOTAL = 10000;

const returnsOf = (h: EngineHolding) => h.closes!.slice(1).map((c, i) => c.close / h.closes![i].close - 1);
const mean = (x: number[]) => x.reduce((s, v) => s + v, 0) / x.length;
const cov = (x: number[], y: number[]) => { const mx = mean(x), my = mean(y); return x.reduce((s, v, i) => s + (v - mx) * (y[i] - my), 0) / (x.length - 1); };

describe('the engine against an independent computation', () => {
    const out = computeEngine({ holdings: HOLDINGS, cashCad: CASH, fx: [] });
    const w = out.windows.full;
    if (!w.available) throw new Error('expected the full window');

    const r = HOLDINGS.map(returnsOf);
    const weights = HOLDINGS.map((h) => h.valueCad / TOTAL);
    // Full covariance matrix and the quadratic form
    const S = r.map((a) => r.map((b) => cov(a, b)));
    const Sw = S.map((row) => row.reduce((s, v, j) => s + v * weights[j], 0));
    const variance = weights.reduce((s, wi, i) => s + wi * Sw[i], 0);

    it('annualised volatility equals sqrt(w S w) x sqrt(observations a year of the calendar used)', () => {
        // 400 weekdays, no holidays: (returns) / (calendar days spanned / 365.25), about 261 a year
        const spanDays = (Date.parse(dates[dates.length - 1]) - Date.parse(dates[0])) / DAY;
        const perYear = (dates.length - 1) / (spanDays / 365.25);
        expect(perYear).toBeGreaterThan(255);
        expect(perYear).toBeLessThan(265);
        expect(w.calendar).toBe('exchange');
        expect(w.periodsPerYear).toBeCloseTo(perYear, 1);
        expect(w.volatilityPct).toBeCloseTo(Math.sqrt(variance) * Math.sqrt(perYear) * 100, 1);
    });

    it('each risk share equals w_i (S w)_i / (w S w), and they add up to 100 %', () => {
        HOLDINGS.forEach((h, i) => {
            const mine = w.risk.find((x) => x.symbol === h.symbol)!;
            expect(mine.riskSharePct!).toBeCloseTo(((weights[i] * Sw[i]) / variance) * 100, 1);
        });
        expect(w.risk.reduce((s, x) => s + x.riskSharePct!, 0)).toBeCloseTo(100, 1);
    });

    it('the maximum drawdown equals a brute-force search over every peak-trough pair', () => {
        const portfolio = r[0].map((_, t) => weights.reduce((s, wi, i) => s + wi * r[i][t], 0));
        const curve = [100];
        portfolio.forEach((x) => curve.push(curve[curve.length - 1] * (1 + x)));
        let worst = 0;
        for (let i = 0; i < curve.length; i++) for (let j = i + 1; j < curve.length; j++) worst = Math.min(worst, curve[j] / curve[i] - 1);
        expect(w.maxDrawdown.pct).toBeCloseTo(worst * 100, 1);
    });

    it('the diversification ratio equals sum(w sigma) / sigma_p, and is at least 1', () => {
        const sigma = r.map((x) => Math.sqrt(cov(x, x)));
        const expected = weights.reduce((s, wi, i) => s + wi * sigma[i], 0) / Math.sqrt(variance);
        expect(w.diversificationRatio!).toBeCloseTo(expected, 1);
        expect(w.diversificationRatio!).toBeGreaterThanOrEqual(1);
    });

    it('the shares and the effective number of holdings follow their definitions', () => {
        expect(out.holdings.reduce((s, h) => s + h.sharePct, 0) + out.cashSharePct).toBeCloseTo(100, 1);
        const invested = HOLDINGS.reduce((s, h) => s + h.valueCad, 0);
        expect(out.concentration.effectiveHoldings!).toBeCloseTo(1 / HOLDINGS.reduce((s, h) => s + (h.valueCad / invested) ** 2, 0), 1);
    });

    it('is deterministic: the same inputs give the same output', () => {
        expect(computeEngine({ holdings: HOLDINGS, cashCad: CASH, fx: [] })).toEqual(out);
    });
});
