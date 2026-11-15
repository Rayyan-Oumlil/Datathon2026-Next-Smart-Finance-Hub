import { describe, expect, it } from 'vitest';
import type { DailyClose } from '@/lib/sources/types';
import { correlation, maxDrawdown, periodReturn, windowOf, type Series } from '@/lib/services/portfolio-stats';
import { sourced } from './helpers';

const series = (symbol: string, rows: DailyClose[]): Series => ({ symbol, closes: sourced(rows, { source: 'closes stub', currency: 'USD' }) });

const ROWS: DailyClose[] = [
    { date: '2026-10-01', close: 90 },      // outside the last month
    { date: '2026-10-13', close: 100 },
    { date: '2026-10-20', close: 120 },
    { date: '2026-11-02', close: 90 },
    { date: '2026-11-13', close: 110 },
];

// 21 consecutive days, built from a list of daily returns
function fromReturns(returns: number[], start = 100): DailyClose[] {
    const rows: DailyClose[] = [{ date: '2026-10-20', close: start }];
    returns.forEach((r, i) => {
        const date = new Date(Date.UTC(2026, 9, 21 + i)).toISOString().slice(0, 10);
        rows.push({ date, close: rows[rows.length - 1].close * (1 + r) });
    });
    return rows;
}
const repeat = (pattern: number[], times: number) => Array.from({ length: times }, () => pattern).flat();

describe('windowOf', () => {
    it('starts on the same day N months before the last close', () => {
        expect(windowOf(ROWS, '1m').map((row) => row.date)).toEqual(['2026-10-13', '2026-10-20', '2026-11-02', '2026-11-13']);
        expect(windowOf(ROWS, '3m')).toHaveLength(5);
        expect(windowOf([], '1y')).toEqual([]);
    });
});

describe('periodReturn', () => {
    it('is last close over first close of the period: 110 / 100 - 1 = 10%', () => {
        const result = periodReturn(series('AAA', ROWS), '1m');
        expect(result).toMatchObject({ metric: 'return', period: '1m', result: 10, unit: '%', from: '2026-10-13', to: '2026-11-13', observations: 4 });
        expect(result.method).toContain('last 1m');
        expect(result.sources).toEqual([expect.objectContaining({ source: 'closes stub', fetchedAt: expect.any(String), value: 'AAA: 4 daily closes, 2026-10-13 to 2026-11-13' })]);
    });
    it('over 3 months starts at 90: 110 / 90 - 1 = 22.22%', () => {
        expect(periodReturn(series('AAA', ROWS), '3m').result).toBe(22.22);
    });
    it('gives no number with fewer than two closes', () => {
        expect(periodReturn(series('AAA', ROWS.slice(-1)), '1m').result).toBeNull();
        expect(periodReturn(series('AAA', []), '1m').result).toBeNull();
    });
});

describe('maxDrawdown', () => {
    it('is the fall from the 120 peak to the later 90 close: -25%', () => {
        const result = maxDrawdown(series('AAA', ROWS), '1m');
        expect(result.result).toBe(-25);
        expect(result.detail).toEqual({ peakDate: '2026-10-20', peakClose: 120, troughDate: '2026-11-02', troughClose: 90 });
    });
    it('is 0 for a series that only rises', () => {
        expect(maxDrawdown(series('AAA', [{ date: '2026-11-01', close: 1 }, { date: '2026-11-02', close: 2 }, { date: '2026-11-03', close: 3 }]), '1m').result).toBe(0);
    });
});

describe('correlation', () => {
    const x = fromReturns(repeat([0.01, 0.02], 10));
    it('is 1 for identical returns and -1 for mirrored ones', () => {
        expect(correlation(series('X', x), series('Y', fromReturns(repeat([0.01, 0.02], 10), 50)), '1m').result).toBe(1);
        expect(correlation(series('X', x), series('Y', fromReturns(repeat([-0.01, -0.02], 10))), '1m').result).toBe(-1);
    });
    it('is 0 when the deviations cancel: x = (.01,.02) x10, y = (.02,.01,.01,.02) x5', () => {
        expect(correlation(series('X', x), series('Y', fromReturns(repeat([0.02, 0.01, 0.01, 0.02], 5))), '1m').result).toBeCloseTo(0, 4);
    });
    it('is 1/sqrt(3) = 0.5774 for y = (.01,.02,.01,.01) x5 (worked by hand: Sxy 5e-5, Sxx 1e-4, Syy 7.5e-5 per four returns)', () => {
        const result = correlation(series('X', x), series('Y', fromReturns(repeat([0.01, 0.02, 0.01, 0.01], 5))), '1m');
        expect(result.result).toBe(0.5774);
        expect(result).toMatchObject({ observations: 20, symbols: ['X', 'Y'], from: '2026-10-20', to: '2026-11-09' });
        expect(result.sources).toHaveLength(2);
    });
    it('uses only the dates both series have', () => {
        const y = [{ date: '2026-10-18', close: 7 }, { date: '2026-10-19', close: 70 }, ...fromReturns(repeat([0.01, 0.02], 10), 50)];
        expect(correlation(series('X', x), series('Y', y), '1m')).toMatchObject({ result: 1, observations: 20 });
    });
    it('gives no number under 20 common returns, or for a series that never moved', () => {
        expect(correlation(series('X', x.slice(0, 20)), series('Y', x), '1m').result).toBeNull();
        expect(correlation(series('X', x), series('Y', fromReturns(repeat([0], 20))), '1m').result).toBeNull();
    });
});
