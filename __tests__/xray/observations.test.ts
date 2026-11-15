import { describe, expect, it } from 'vitest';
import { OBSERVATION_RULES, observationsOf } from '@/lib/xray/observations';
import type { WindowResult } from '@/lib/xray/types';

type W = Extract<WindowResult, { available: true }>;

const win = (over: Partial<W> = {}): W => ({
    id: 'full', available: true, from: '2021-11-15', to: '2026-11-13', observations: 1200,
    coverage: { sharePct: 100, included: ['A', 'B', 'C'], excluded: [], gaps: [] }, calendar: 'exchange', periodsPerYear: 252,
    volatilityPct: 10, maxDrawdown: { pct: -10, peakDate: 'a', troughDate: 'b', recoveredDate: null },
    worstDay: { pct: -2, date: 'x' }, worstSpan20: null, diversificationRatio: 1.5, pairs: [{ a: 'A', b: 'B', correlation: 0.3 }], curve: [],
    risk: [
        { symbol: 'A', weightPct: 30, volatilityPct: 20, riskSharePct: 34 },
        { symbol: 'B', weightPct: 30, volatilityPct: 20, riskSharePct: 33 },
        { symbol: 'C', weightPct: 30, volatilityPct: 20, riskSharePct: 33 },
    ],
    ...over,
});
const input = (over: Partial<Parameters<typeof observationsOf>[0]> = {}) => ({
    holdings: [{ symbol: 'A', valueCad: 3000, currency: 'CAD' }, { symbol: 'B', valueCad: 3000, currency: 'CAD' }, { symbol: 'C', valueCad: 3000, currency: 'CAD' }],
    concentration: { topHolding: { symbol: 'A', sharePct: 30 }, effectiveHoldings: 3 },
    currencies: [{ name: 'CAD', sharePct: 100 }],
    cashSharePct: 10,
    band: { volatilityLimitPct: 35 },
    window: win(),
    ...over,
});
const ids = (over?: Parameters<typeof input>[0]) => observationsOf(input(over)).map((o) => o.id);

describe('observationsOf', () => {
    it('says nothing about a plain, balanced portfolio, except a top holding at the threshold', () => {
        expect(ids()).toEqual(['top_holding']);
        expect(ids({ concentration: { topHolding: { symbol: 'A', sharePct: 29.9 }, effectiveHoldings: 3 } })).toEqual([]);
    });

    it('names the holding whose risk share far exceeds its value share, with a link that opens the lab on it, no amount pre-filled', () => {
        const risk = [
            { symbol: 'A', weightPct: 25, volatilityPct: 28, riskSharePct: 40 },
            { symbol: 'N', weightPct: 15, volatilityPct: 51, riskSharePct: 44.5 },
            { symbol: 'R', weightPct: 60, volatilityPct: 10, riskSharePct: 15.5 },
        ];
        const found = observationsOf(input({
            holdings: [{ symbol: 'A', valueCad: 2500, currency: 'USD' }, { symbol: 'N', valueCad: 1500, currency: 'USD' }, { symbol: 'R', valueCad: 6000, currency: 'CAD' }],
            window: win({ risk }),
        }));
        expect(found[0]).toEqual({ id: 'risk_gap', symbol: 'N', valuePct: 15, riskPct: 44.5, test: { symbol: 'N' } });
        // the lab is opened on the holding with no amount or direction chosen by the app
        expect(Object.keys((found[0] as { test: object }).test)).toEqual(['symbol']);
    });

    it('does not name the same holding twice', () => {
        const risk = [{ symbol: 'A', weightPct: 40, volatilityPct: 50, riskSharePct: 80 }, { symbol: 'B', weightPct: 60, volatilityPct: 5, riskSharePct: 20 }];
        const found = observationsOf(input({
            holdings: [{ symbol: 'A', valueCad: 4000, currency: 'CAD' }, { symbol: 'B', valueCad: 6000, currency: 'CAD' }],
            concentration: { topHolding: { symbol: 'B', sharePct: 60 }, effectiveHoldings: 1.9 },
            window: win({ risk }),
        }));
        expect(found.filter((o) => o.id === 'risk_gap' || o.id === 'top_holding').map((o) => (o as { symbol: string }).symbol)).toEqual(['A', 'B']);
        const same = observationsOf(input({ concentration: { topHolding: { symbol: 'A', sharePct: 40 }, effectiveHoldings: 3 }, window: win({ risk: [{ symbol: 'A', weightPct: 40, volatilityPct: 50, riskSharePct: 80 }, { symbol: 'B', weightPct: 60, volatilityPct: 5, riskSharePct: 20 }] }) }));
        expect(same.filter((o) => 'symbol' in o && o.symbol === 'A')).toHaveLength(1);
    });

    it('compares the volatility with the limit: above, near (80 % or more), or nothing', () => {
        expect(ids({ window: win({ volatilityPct: 35.01 }) })).toContain('above_band');
        expect(ids({ window: win({ volatilityPct: 28 }) })).toContain('near_band');
        expect(ids({ window: win({ volatilityPct: 27.9 }) })).not.toContain('near_band');
        expect(ids({ band: null, window: win({ volatilityPct: 90 }) })).not.toContain('above_band');
    });

    it('reads closely moving pairs, little cushion, few positions, USD, cash and holdings left out', () => {
        const all = ids({
            concentration: { topHolding: { symbol: 'A', sharePct: 20 }, effectiveHoldings: 2.4 },
            currencies: [{ name: 'USD', sharePct: 55 }, { name: 'CAD', sharePct: 45 }],
            cashSharePct: 52,
            window: win({ diversificationRatio: 1.05, pairs: [{ a: 'A', b: 'B', correlation: 0.81 }], coverage: { sharePct: 80, included: ['A'], excluded: ['BTC'], gaps: [{ symbol: 'BTC', reason: 'starts_later', firstDate: '2024-11-15', lastDate: '2026-11-13' }] } }),
        });
        expect(all).toEqual(['close_pair', 'little_cushion', 'few_holdings', 'currency']);   // cut to the first four
    });

    it('keeps at most four readings, in order', () => {
        expect(OBSERVATION_RULES.max).toBe(4);
    });

    it('offers no lab link for a holding with no value, and no cushion reading for one holding', () => {
        const risk = [{ symbol: 'A', weightPct: 10, volatilityPct: 50, riskSharePct: 60 }];
        expect(observationsOf(input({ holdings: [{ symbol: 'A', valueCad: 0, currency: 'CAD' }], window: win({ risk, diversificationRatio: 1 }) })).map((o) => o.id)).not.toContain('risk_gap');
        expect(ids({ window: win({ risk, diversificationRatio: 1 }) })).not.toContain('little_cushion');
    });
});
