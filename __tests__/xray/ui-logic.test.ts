import { describe, expect, it } from 'vitest';
import { bandStatus, bandTrack, clampPct, comparisonOf, direction, sourceSummary, dropFact, isAvailable, leadRow, metricRows, pickWindow, riskRows, segmentsOf, type AvailableWindow } from '@/components/portfolio/xray/logic';
import type { XrayView } from '@/lib/services/portfolio-xray';
import type { WindowResult } from '@/lib/xray/types';

const window = (over: Partial<AvailableWindow> = {}): AvailableWindow => ({
    id: 'full', available: true, from: '2021-11-12', to: '2026-11-13', observations: 1000,
    coverage: { sharePct: 100, included: ['A', 'B', 'C', 'D'], excluded: [], gaps: [] }, calendar: 'exchange', periodsPerYear: 252,
    volatilityPct: 20, maxDrawdown: { pct: -25, peakDate: '2022-01-03', troughDate: '2022-10-12', recoveredDate: null },
    worstDay: { pct: -4, date: '2022-06-13' }, worstSpan20: null, diversificationRatio: 1.2, pairs: [], curve: [],
    risk: [
        { symbol: 'A', weightPct: 40, volatilityPct: 30, riskSharePct: 60 },
        { symbol: 'B', weightPct: 30, volatilityPct: 15, riskSharePct: 20 },
        { symbol: 'C', weightPct: 20, volatilityPct: 10, riskSharePct: 15 },
        { symbol: 'D', weightPct: 10, volatilityPct: 8, riskSharePct: 5 },
    ],
    ...over,
});
const none = (id: 'last3y' | 'last1y' | 'full'): WindowResult => ({ id, available: false, reason: 'not_enough_history' });

describe('window choice', () => {
    it('keeps the wanted window when it can be replayed, else the first that can', () => {
        const windows = { full: window(), last3y: none('last3y'), last1y: window({ id: 'last1y' }) };
        expect(pickWindow(windows, 'full')).toBe('full');
        expect(pickWindow(windows, 'last3y')).toBe('full');
        expect(pickWindow({ full: none('full'), last3y: none('last3y'), last1y: window({ id: 'last1y' }) }, 'full')).toBe('last1y');
        expect(pickWindow({ full: none('full'), last3y: none('last3y'), last1y: none('last1y') }, 'last3y')).toBe('last3y');
        expect(isAvailable(none('full'))).toBe(false);
    });
});

describe('band', () => {
    it('is within at or below the limit and above beyond it', () => {
        expect(bandStatus(35, 35)).toBe('within');
        expect(bandStatus(35.01, 35)).toBe('above');
    });
    it('places both marks on a track with room beyond the larger one', () => {
        expect(bandTrack(20, 35).limitAt).toBeCloseTo((35 / 42) * 100, 6);
        expect(bandTrack(50, 35).volatilityAt).toBeCloseTo((50 / 60) * 100, 6);
        expect(bandTrack(0, 0)).toEqual({ volatilityAt: 0, limitAt: 0 });
        expect(clampPct(-3)).toBe(0);
        expect(clampPct(140)).toBe(100);
    });
});

describe('rows by level', () => {
    it('shows 3 holdings to a Novice, 6 to an Intermediate and all to an Expert, and counts the hidden ones', () => {
        expect(riskRows(window(), 'Novice')).toMatchObject({ hidden: 1 });
        expect(riskRows(window(), 'Novice').rows.map((r) => r.symbol)).toEqual(['A', 'B', 'C']);
        expect(riskRows(window(), 'Intermediate')).toMatchObject({ hidden: 0 });
        expect(riskRows(window(), 'Expert').rows).toHaveLength(4);
    });
    it('names the holding whose risk share exceeds its value share the most', () => {
        expect(leadRow(window())?.symbol).toBe('A');
        const calm = window({ risk: [{ symbol: 'A', weightPct: 50, volatilityPct: 5, riskSharePct: 40 }, { symbol: 'B', weightPct: 50, volatilityPct: 5, riskSharePct: 50 }] });
        expect(leadRow(calm)).toBeNull();   // B's risk share only equals its value share
        expect(leadRow(window({ risk: [{ symbol: 'A', weightPct: 100, volatilityPct: 0, riskSharePct: null }] }))).toBeNull();
        expect(leadRow(window({ risk: [{ symbol: 'A', weightPct: 50, volatilityPct: 5, riskSharePct: 50 }, { symbol: 'B', weightPct: 50, volatilityPct: 5, riskSharePct: 50 }] }))).toBeNull();
    });
});

describe('the answer to the drop question', () => {
    it('appears only when the replay fell by 20 % or more', () => {
        expect(dropFact({ dropAnswer: 'sell' }, window())).toEqual({ answer: 'sell', fallPct: -25 });
        expect(dropFact({ dropAnswer: 'sell' }, window({ maxDrawdown: { pct: -19.99, peakDate: 'a', troughDate: 'b', recoveredDate: null } }))).toBeNull();
        expect(dropFact({ dropAnswer: null }, window())).toBeNull();
    });
});

describe('what-if rows', () => {
    const view = (over: Partial<XrayView>): XrayView => ({
        concentration: { topHolding: { symbol: 'A', sharePct: 40 }, top3SharePct: 90, effectiveHoldings: 3, groups: [], assetClasses: [], currencies: [] },
        cashSharePct: 10, windows: { full: window(), last3y: none('last3y'), last1y: none('last1y') }, ...over,
    } as XrayView);
    it('reads the concentration and the chosen window, and gives null where a window is unavailable', () => {
        const after = view({ cashSharePct: 5, concentration: { topHolding: { symbol: 'A', sharePct: 45 }, top3SharePct: 95, effectiveHoldings: 2.6, groups: [], assetClasses: [], currencies: [] }, windows: { full: window({ volatilityPct: 24 }), last3y: none('last3y'), last1y: none('last1y') } });
        const rows = metricRows(view({}), after, 'full');
        expect(rows.find((r) => r.key === 'largest')).toMatchObject({ before: 40, after: 45 });
        expect(rows.find((r) => r.key === 'volatility')).toMatchObject({ before: 20, after: 24 });
        expect(rows.find((r) => r.key === 'cash')).toMatchObject({ before: 10, after: 5 });
        expect(rows.find((r) => r.key === 'coverage')).toMatchObject({ kind: 'share', before: 100, after: 100 });
        expect(metricRows(view({}), after, 'last3y').find((r) => r.key === 'volatility')).toMatchObject({ before: null, after: null });
    });
    it('gives the period shared by both sides, what is left out, and why the after side is missing', () => {
        const gap = { symbol: 'NEW', reason: 'no_history' as const, firstDate: null, lastDate: null };
        const missing = view({ windows: { full: { id: 'full', available: false, reason: 'changed_asset_no_history', gap }, last3y: none('last3y'), last1y: none('last1y') } });
        expect(comparisonOf(view({}), missing, 'full')).toEqual({ period: { from: '2021-11-12', to: '2026-11-13' }, afterGap: gap, gaps: [], coveragePct: 100 });
        const partial = window({ coverage: { sharePct: 80, included: ['A'], excluded: ['G'], gaps: [{ symbol: 'G', reason: 'starts_later', firstDate: '2024-11-15', lastDate: '2026-11-13' }] } });
        const both = view({ windows: { full: partial, last3y: none('last3y'), last1y: none('last1y') } });
        expect(comparisonOf(both, both, 'full')).toMatchObject({ afterGap: null, coveragePct: 80, gaps: [{ symbol: 'G', firstDate: '2024-11-15' }] });
        expect(comparisonOf(view({}), view({}), 'last1y')).toEqual({ period: null, afterGap: null, gaps: [], coveragePct: null });
    });
    it('reads the direction of a change', () => {
        expect(direction(10, 12)).toBe('up');
        expect(direction(12, 10)).toBe('down');
        expect(direction(10, 10.001)).toBe('same');
        expect(direction(null, 3)).toBeNull();
    });
});

describe('exposure segments', () => {
    it('keeps five or fewer as they are and folds the rest into one segment', () => {
        const rows = Array.from({ length: 7 }, (_, i) => ({ name: `S${i}`, sharePct: 10 }));
        expect(segmentsOf(rows.slice(0, 5))).toHaveLength(5);
        const folded = segmentsOf(rows);
        expect(folded).toHaveLength(5);
        expect(folded[4]).toEqual({ name: '', sharePct: 30, rest: 3 });
    });
});

describe('source summary', () => {
    const sources = [
        { value: 'A: 100 daily values', source: 'TMX Money', fetchedAt: 'x' },
        { value: 'B: 100 daily values', source: 'Kraken', fetchedAt: 'x' },
        { value: 'C: 100 daily values', source: 'TMX Money', fetchedAt: 'x' },
        { value: 'USD/CAD: 100 daily values', source: 'Bank of Canada', fetchedAt: 'x' },
    ];
    const holdings = [{ symbol: 'A', currency: 'CAD' }, { symbol: 'B', currency: 'USD' }, { symbol: 'C', currency: 'CAD' }] as XrayView['holdings'];
    it('names each provider of the series the window used once, with the rate when a USD series is in it', () => {
        expect(sourceSummary({ sources, holdings }, window({ coverage: { sharePct: 100, included: ['A', 'B', 'C'], excluded: [], gaps: [] } }))).toEqual(['TMX Money', 'Kraken', 'Bank of Canada']);
        expect(sourceSummary({ sources, holdings }, window({ coverage: { sharePct: 60, included: ['A', 'C'], excluded: ['B'], gaps: [] } }))).toEqual(['TMX Money']);
        expect(sourceSummary({ sources, holdings }, null)).toEqual(['TMX Money', 'Kraken', 'Bank of Canada']);
    });
});
