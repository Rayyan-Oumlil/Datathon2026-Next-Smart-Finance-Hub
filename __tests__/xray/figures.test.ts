import { describe, expect, it } from 'vitest';
import { agentFigures } from '@/lib/xray/figures';
import type { EngineOutput, WindowResult } from '@/lib/xray/types';

const win = (id: 'full' | 'last3y' | 'last1y'): WindowResult => ({
    id, available: true, from: '2025-11-13', to: '2026-11-13', observations: 246,
    coverage: { sharePct: 100, included: ['A'], excluded: [] }, volatilityPct: 10.37,
    maxDrawdown: { pct: -5.46, peakDate: '2026-02-25', troughDate: '2026-03-20', recoveredDate: null },
    worstDay: { pct: -2.1, date: '2026-03-02' }, worstSpan20: null, diversificationRatio: 1.5, pairs: [], curve: [],
    risk: [{ symbol: 'A', weightPct: 60, volatilityPct: 20, riskSharePct: 70 }, { symbol: 'B', weightPct: 40, volatilityPct: 10, riskSharePct: null }],
});
const out = {
    holdings: [], cashCad: 0, cashSharePct: 30, totalValueCad: 100, noHistory: [],
    concentration: { topHolding: { symbol: 'A', sharePct: 25 }, top3SharePct: 60, effectiveHoldings: 3.6, groups: [], assetClasses: [], currencies: [] },
    windows: { full: win('full'), last3y: { id: 'last3y', available: false, reason: 'not_enough_history' }, last1y: win('last1y') },
} as EngineOutput;
const stamp = { computedAt: '2026-11-15T09:00:00.000Z', sources: [{ value: 'A: 1', source: 'TMX Money (delayed 15 min or more)', fetchedAt: 'x' }, { value: 'B: 1', source: 'TMX Money (delayed 15 min or more)', fetchedAt: 'x' }, { value: 'USD/CAD', source: 'Bank of Canada', fetchedAt: 'x' }] };

describe('agentFigures', () => {
    const figures = agentFigures(out, stamp) as Record<string, any>;

    it('repeats each headline figure as a sourced value: version, series used, time and as-of date', () => {
        expect(figures.volatility_last1y).toMatchObject({
            value: 10.37, unit: '%', fetchedAt: '2026-11-15T09:00:00.000Z', asOf: '2026-11-13',
            source: 'derived (xray-v1) from daily closes: TMX Money (delayed 15 min or more), Bank of Canada',
        });
        expect(figures.maxDrawdown_full.note).toContain('2026-02-25 to 2026-03-20');
        expect(figures.topShare.value).toBe(25);
        expect(figures.cashShare.value).toBe(30);
    });

    it('puts the window in every key, so a source label says which period it belongs to', () => {
        expect(Object.keys(figures).filter((k) => k.includes('_'))).toEqual(expect.arrayContaining(['volatility_full', 'volatility_last1y', 'holdings_full']));
        expect(figures.holdings_last1y[0]).toMatchObject({ symbol: 'A', weight_last1y: { value: 60 }, riskShare_last1y: { value: 70 } });
    });

    it('leaves out a window that was not replayed and a risk share that could not be split', () => {
        expect(Object.keys(figures).some((k) => k.endsWith('last3y'))).toBe(false);
        expect(figures.holdings_last1y[1]).toEqual({ symbol: 'B', weight_last1y: expect.objectContaining({ value: 40 }) });
    });

    it('says plainly when no history was used', () => {
        const none = agentFigures(out, { computedAt: stamp.computedAt, sources: [] }) as Record<string, any>;
        expect(none.volatility_full.source).toContain('no price history');
    });
});
