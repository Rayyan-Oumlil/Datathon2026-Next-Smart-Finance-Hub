import { describe, expect, it } from 'vitest';
import { computeEngine } from '@/lib/xray/engine';
import type { EngineHolding } from '@/lib/xray/types';

const DAY = 24 * 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const END = Date.parse('2026-11-13T00:00:00Z');

/** The last n weekdays up to END, oldest first. */
function weekdays(n: number): string[] {
    const out: string[] = [];
    for (let ms = END; out.length < n; ms -= DAY) {
        const day = new Date(ms).getUTCDay();
        if (day !== 0 && day !== 6) out.unshift(iso(ms));
    }
    return out;
}
/** The last n calendar days up to END, oldest first. */
const everyDay = (n: number) => Array.from({ length: n }, (_, i) => iso(END - (n - 1 - i) * DAY));
const closesFrom = (dates: string[], returns: number[], start = 100) => {
    let level = start;
    return dates.map((date, i) => ({ date, close: i === 0 ? level : (level *= 1 + returns[i - 1]) }));
};
const pattern = (n: number, kind: 'A' | 'B') => Array.from({ length: n }, (_, i) => ((kind === 'A' ? i % 2 : Math.floor(i / 2) % 2) === 0 ? 0.01 : -0.01));

const holding = (over: Partial<EngineHolding> & Pick<EngineHolding, 'symbol' | 'valueCad'>): EngineHolding => ({
    name: over.symbol, group: 'Industrials', assetClass: 'stock', currency: 'CAD', isCrypto: false, closes: null, ...over,
});

const FX = [{ date: '2020-01-01', rate: 1.25 }];

describe('shares and concentration', () => {
    const dates = weekdays(121);
    const a = holding({ symbol: 'A', group: 'Energy', valueCad: 5000, closes: closesFrom(dates, pattern(120, 'A')) });
    const b = holding({ symbol: 'B', group: 'Financials', valueCad: 3000, currency: 'USD', closes: closesFrom(dates, pattern(120, 'B')) });
    const out = computeEngine({ holdings: [a, b], cashCad: 2000, fx: FX });

    it('computes the shares of the whole portfolio, cash included, largest first', () => {
        expect(out.totalValueCad).toBe(10000);
        expect(out.holdings.map((h) => [h.symbol, h.sharePct])).toEqual([['A', 50], ['B', 30]]);
        expect(out.cashSharePct).toBe(20);
        expect(out.concentration.topHolding).toEqual({ symbol: 'A', sharePct: 50 });
        expect(out.concentration.top3SharePct).toBe(80);
    });
    it('computes the effective number of holdings over the invested part: 1 / (0.625^2 + 0.375^2) = 1.88', () => {
        expect(out.concentration.effectiveHoldings).toBe(1.88);
    });
    it('groups by sector, asset class and currency, with cash counted as CAD', () => {
        expect(out.concentration.groups).toEqual([{ name: 'Energy', sharePct: 50 }, { name: 'Financials', sharePct: 30 }]);
        expect(out.concentration.assetClasses).toEqual([{ name: 'stock', sharePct: 80 }]);
        expect(out.concentration.currencies).toEqual([{ name: 'CAD', sharePct: 70 }, { name: 'USD', sharePct: 30 }]);
    });
});

describe('an empty portfolio', () => {
    it('is cash only, with every window unavailable for want of holdings', () => {
        const out = computeEngine({ holdings: [], cashCad: 10000, fx: FX });
        expect(out.cashSharePct).toBe(100);
        expect(out.concentration.topHolding).toBeNull();
        expect(out.concentration.effectiveHoldings).toBeNull();
        expect(Object.values(out.windows).every((w) => !w.available && w.reason === 'no_holdings')).toBe(true);
    });
});

describe('the replay', () => {
    const dates = weekdays(121);
    const a = holding({ symbol: 'A', valueCad: 5000, closes: closesFrom(dates, pattern(120, 'A')) });
    const b = holding({ symbol: 'B', valueCad: 5000, closes: closesFrom(dates, pattern(120, 'B')) });

    it('splits the risk 50/50 for two orthogonal assets at equal weights', () => {
        const w = computeEngine({ holdings: [a, b], cashCad: 0, fx: FX }).windows.full;
        expect(w.available).toBe(true);
        if (!w.available) return;
        expect(w.risk.map((r) => r.riskSharePct)).toEqual([50, 50]);
        expect(w.observations).toBe(120);
        expect(w.coverage).toEqual({ sharePct: 100, included: ['A', 'B'], excluded: [] });
        expect(w.diversificationRatio!).toBeGreaterThan(1);
        expect(w.from).toBe(dates[0]);
        expect(w.to).toBe(dates[120]);
    });

    it('halves the volatility when half the portfolio is cash', () => {
        const alone = computeEngine({ holdings: [holding({ ...a, valueCad: 10000 })], cashCad: 0, fx: FX }).windows.full;
        const half = computeEngine({ holdings: [holding({ ...a, valueCad: 5000 })], cashCad: 5000, fx: FX }).windows.full;
        if (!alone.available || !half.available) throw new Error('expected both windows');
        expect(half.volatilityPct).toBeCloseTo(alone.volatilityPct / 2, 1);
        expect(half.risk[0].weightPct).toBe(50);
    });

    it('shows the exchange rate: a flat USD stock moves by the USD/CAD change', () => {
        const flat = closesFrom(dates, Array(120).fill(0));
        const fx = [{ date: dates[0], rate: 1.25 }, { date: dates[60], rate: 1.3 }];
        const usd = holding({ symbol: 'U', currency: 'USD', valueCad: 1000, closes: flat });
        const w = computeEngine({ holdings: [usd], cashCad: 0, fx }).windows.full;
        if (!w.available) throw new Error('expected a window');
        expect(w.curve[w.curve.length - 1].value).toBeCloseTo(104, 1);   // 1.30 / 1.25 = +4 %
        expect(w.maxDrawdown.pct).toBe(0);
    });

    it('reports a window with too little history as unavailable, never a guess', () => {
        const out = computeEngine({ holdings: [a, b], cashCad: 0, fx: FX });
        // The series do not reach back three years from today's end, so 3 years is all of them: same as the full window
        expect(out.windows.last3y.available).toBe(true);
        expect(out.windows.last1y.available).toBe(true);
        const short = computeEngine({ holdings: [holding({ symbol: 'S', valueCad: 100, closes: closesFrom(weekdays(30), pattern(29, 'A')) })], cashCad: 0, fx: FX });
        expect(short.windows.full).toEqual({ id: 'full', available: false, reason: 'not_enough_history' });
    });

    it('lists a holding with no closes and still replays the others', () => {
        const ghost = holding({ symbol: 'G', valueCad: 1000, closes: null });
        const out = computeEngine({ holdings: [a, ghost], cashCad: 0, fx: FX });
        expect(out.noHistory).toEqual(['G']);
        const w = out.windows.full;
        expect(w.available && w.coverage.sharePct).toBeCloseTo((5000 / 6000) * 100, 2);
        const none = computeEngine({ holdings: [ghost], cashCad: 0, fx: FX });
        expect(none.windows.full).toEqual({ id: 'full', available: false, reason: 'not_enough_history' });
    });
});

describe('coverage across windows', () => {
    // Stocks: about 1.8 years of weekdays. Crypto: 380 calendar days, so it covers the last year but not the whole span.
    const stockDates = weekdays(460);
    const stock = holding({ symbol: 'S', valueCad: 6000, closes: closesFrom(stockDates, pattern(459, 'A')) });
    const cryptoDates = everyDay(380);
    const btc = holding({ symbol: 'BTC', assetClass: 'crypto', group: 'Crypto', isCrypto: true, valueCad: 4000, closes: closesFrom(cryptoDates, pattern(379, 'B')) });
    const out = computeEngine({ holdings: [stock, btc], cashCad: 0, fx: FX });

    it('leaves out a holding that does not reach back to the start of the window, names it, and states the coverage', () => {
        const full = out.windows.full;
        if (!full.available) throw new Error('expected the full window');
        expect(full.coverage.included).toEqual(['S']);
        expect(full.coverage.excluded).toEqual(['BTC']);
        expect(full.coverage.sharePct).toBe(60);
        expect(full.risk[0].weightPct).toBe(100);   // renormalised over what is covered
    });
    it('includes it in the last year, where its history is long enough', () => {
        const last = out.windows.last1y;
        if (!last.available) throw new Error('expected the last-year window');
        expect(last.coverage.included.sort()).toEqual(['BTC', 'S']);
        expect(last.coverage.sharePct).toBe(100);
        const total = last.risk.reduce((sum, r) => sum + (r.riskSharePct ?? 0), 0);
        expect(total).toBeCloseTo(100, 1);
    });
    it('keeps the chart curve short and holds the worst fall inside it', () => {
        const full = out.windows.full;
        if (!full.available) throw new Error('expected the full window');
        expect(full.curve.length).toBeLessThanOrEqual(152);
        const dates = new Set(full.curve.map((p) => p.date));
        expect(dates.has(full.maxDrawdown.peakDate) && dates.has(full.maxDrawdown.troughDate)).toBe(true);
    });
});

describe('the three-year window', () => {
    it('replays only the last three years of a longer history', () => {
        const dates: string[] = [];
        for (let ms = Date.parse('2021-11-01T00:00:00Z'); ms <= END; ms += DAY) {
            const day = new Date(ms).getUTCDay();
            if (day !== 0 && day !== 6) dates.push(iso(ms));
        }
        const s = holding({ symbol: 'S', valueCad: 1000, closes: closesFrom(dates, pattern(dates.length - 1, 'A')) });
        const out = computeEngine({ holdings: [s], cashCad: 0, fx: FX });
        const three = out.windows.last3y;
        const full = out.windows.full;
        if (!three.available || !full.available) throw new Error('expected both windows');
        expect(three.from >= '2023-11-13').toBe(true);
        expect(three.to).toBe(full.to);
        expect(three.observations).toBeLessThan(full.observations);
        expect(three.observations).toBeGreaterThan(740);
    });
});
