import { describe, expect, it } from 'vitest';
import {
    annualVolPct, correlationOf, curveOf, diversificationRatio, maxDrawdownOf, returnsOf, riskShares, sampleCov, thin, topPairs, worstDayOf, worstSpanOf,
} from '@/lib/xray/stats';
import { calendarKindOf, periodsPerYearOf } from '@/lib/xray/align';

// Two patterns that are orthogonal (zero covariance) and have the same spread, in blocks of four days
const A = Array.from({ length: 8 }, (_, i) => (i % 2 === 0 ? 0.01 : -0.01));
const B = Array.from({ length: 8 }, (_, i) => (Math.floor(i / 2) % 2 === 0 ? 0.01 : -0.01));
const mix = (weights: number[], series: number[][]) => series[0].map((_, t) => weights.reduce((sum, w, i) => sum + w * series[i][t], 0));

describe('covariance and correlation', () => {
    it('are zero for orthogonal patterns and one for identical ones', () => {
        expect(sampleCov(A, B)).toBeCloseTo(0, 12);
        expect(correlationOf(A, B)).toBeCloseTo(0, 12);
        expect(correlationOf(A, A)).toBeCloseTo(1, 12);
        expect(correlationOf(A, A.map((v) => -v))).toBeCloseTo(-1, 12);
    });
    it('give nothing for a series that never moved', () => {
        expect(correlationOf(A, A.map(() => 0.005))).toBeNull();
        expect(sampleCov([1], [1])).toBeNaN();
    });
});

describe('volatility', () => {
    it('is the sample stdev x sqrt(252): +-1% over four days is 18.33 %', () => {
        expect(annualVolPct([0.01, -0.01, 0.01, -0.01])).toBeCloseTo(18.33, 2);
    });
    it('is zero for constant returns', () => {
        expect(annualVolPct([0.002, 0.002, 0.002])).toBeCloseTo(0, 10);
    });
});

describe('risk shares (Euler decomposition)', () => {
    it('split 50/50 for two orthogonal assets of equal spread at equal weights', () => {
        const rp = mix([0.5, 0.5], [A, B]);
        const shares = riskShares([0.5, 0.5], [A, B], rp);
        expect(shares[0]).toBeCloseTo(50, 8);
        expect(shares[1]).toBeCloseTo(50, 8);
    });
    it('equal the weights when the assets are identical, and the diversification ratio is 1', () => {
        const rp = mix([0.7, 0.3], [A, A]);
        const shares = riskShares([0.7, 0.3], [A, A], rp);
        expect(shares[0]).toBeCloseTo(70, 8);
        expect(shares[1]).toBeCloseTo(30, 8);
        expect(diversificationRatio([0.7, 0.3], [A, A], rp)).toBeCloseTo(1, 10);
    });
    it('always add up to 100 %, and an uncorrelated pair has a ratio above 1', () => {
        const rp = mix([0.8, 0.2], [A, B]);
        const shares = riskShares([0.8, 0.2], [A, B], rp);
        expect(shares[0]! + shares[1]!).toBeCloseTo(100, 8);
        expect(diversificationRatio([0.8, 0.2], [A, B], rp)!).toBeGreaterThan(1);
    });
    it('are null, not zero, when the portfolio never moved (two perfectly offsetting assets)', () => {
        const negA = A.map((v) => -v);
        const rp = mix([0.5, 0.5], [A, negA]);
        expect(riskShares([0.5, 0.5], [A, negA], rp)).toEqual([null, null]);
        expect(diversificationRatio([0.5, 0.5], [A, negA], rp)).toBeNull();
    });
});

describe('curve and drawdown', () => {
    const dates = ['d0', 'd1', 'd2', 'd3', 'd4'];
    it('compounds the returns from 100', () => {
        const curve = curveOf(dates.slice(0, 4), [0.1, -0.2, 0.05]);
        expect(curve.map((p) => Math.round(p.value * 100) / 100)).toEqual([100, 110, 88, 92.4]);
    });
    it('finds the fall from the 110 peak to the 88 trough, -20 %, and no recovery', () => {
        const curve = curveOf(dates.slice(0, 4), [0.1, -0.2, 0.05]);
        expect(maxDrawdownOf(curve)).toEqual({ pct: -20, peakDate: 'd1', troughDate: 'd2', recoveredDate: null });
    });
    it('reports the day the peak was regained', () => {
        const curve = curveOf(dates, [0.1, -0.2, 0.05, 0.25]);   // 100, 110, 88, 92.4, 115.5
        expect(maxDrawdownOf(curve).recoveredDate).toBe('d4');
    });
    it('is 0 for a curve that only rises', () => {
        expect(maxDrawdownOf(curveOf(dates.slice(0, 3), [0.01, 0.02]))).toEqual({ pct: 0, peakDate: 'd0', troughDate: 'd0', recoveredDate: null });
    });
    it('finds the worst day and the worst span', () => {
        expect(worstDayOf(dates.slice(0, 4), [0.01, -0.03, 0.02])).toEqual({ pct: -3, date: 'd2' });
        const curve = curveOf(dates, [0.1, -0.2, 0.05, 0.25]);
        expect(worstSpanOf(curve, 2)).toEqual({ pct: -16, from: 'd1', to: 'd3' });   // 92.4 / 110 - 1
        expect(worstSpanOf(curve, 9)).toBeNull();
    });
});

describe('helpers', () => {
    it('returnsOf gives simple returns', () => {
        expect(returnsOf([100, 110, 99])).toEqual([0.10000000000000009, -0.09999999999999998]);
    });
    it('topPairs orders by correlation and skips a pair with a flat side', () => {
        const flat = A.map(() => 0.001);
        const pairs = topPairs(['A', 'B', 'C', 'F'], [A, B, A.map((v) => v * 2), flat], 2);
        expect(pairs[0]).toEqual({ a: 'A', b: 'C', correlation: 1 });
        expect(pairs).toHaveLength(2);
        expect(pairs.every((p) => p.a !== 'F' && p.b !== 'F')).toBe(true);
    });
    it('thin keeps the ends and the dates asked for, within the limit plus those', () => {
        const points = Array.from({ length: 1000 }, (_, i) => ({ date: `d${String(i).padStart(4, '0')}` }));
        const thinned = thin(points, 100, ['d0555']);
        expect(thinned[0]).toBe(points[0]);
        expect(thinned[thinned.length - 1]).toBe(points[999]);
        expect(thinned.some((p) => p.date === 'd0555')).toBe(true);
        expect(thinned.length).toBeLessThanOrEqual(102);
        expect(thin(points.slice(0, 50), 100, [])).toHaveLength(50);
    });
});

describe('annualisation by the calendar actually used', () => {
    // +-1 % over four days: sample stdev = sqrt(4 x 0.0001 / 3) = 0.0115470
    const swings = [0.01, -0.01, 0.01, -0.01];
    const dayList = (first: string, last: string, count: number) => [first, ...Array.from({ length: count - 2 }, () => first), last];

    it('counts about 365 observations a year for an every-day calendar (crypto alone): 365 returns over 365 days', () => {
        const everyDay2024 = Array.from({ length: 366 }, (_, i) => new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10));
        expect(everyDay2024[365]).toBe('2024-12-31');
        // 365 returns / (365 days / 365.25) = 365.25
        expect(periodsPerYearOf(everyDay2024)).toBeCloseTo(365.25, 6);
        expect(calendarKindOf(periodsPerYearOf(everyDay2024))).toBe('every_day');
        // 0.0115470 x sqrt(365.25) = 22.07 %, where sqrt(252) gave 18.33 %: about 17 % lower
        expect(annualVolPct(swings, periodsPerYearOf(everyDay2024))).toBeCloseTo(22.07, 2);
    });

    it('counts about 252 for an exchange calendar: 252 returns over 365 days', () => {
        const exchange = dayList('2025-01-02', '2026-01-02', 253);
        // 252 returns / (365 / 365.25) = 252.1726
        expect(periodsPerYearOf(exchange)).toBeCloseTo(252.1726, 4);
        expect(calendarKindOf(periodsPerYearOf(exchange))).toBe('exchange');
        // 0.0115470 x sqrt(252.1726) = 18.34 %
        expect(annualVolPct(swings, periodsPerYearOf(exchange))).toBeCloseTo(18.34, 2);
    });

    it('has no rate for fewer than two dates or a zero span', () => {
        expect(periodsPerYearOf(['2026-01-02'])).toBeNaN();
        expect(periodsPerYearOf(['2026-01-02', '2026-01-02'])).toBeNaN();
    });
});
