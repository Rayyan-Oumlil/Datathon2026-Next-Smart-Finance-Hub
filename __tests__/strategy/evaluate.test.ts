// The shared rules evaluator, one rule kind at a time, at its threshold, with numbers worked out by hand.
import { describe, expect, it } from 'vitest';
import { STRATEGY_CONFIG } from '@/lib/strategy/config';
import { evaluateRules, type PortfolioState } from '@/lib/strategy/evaluate';
import { bothLanguages, eventTextRef } from '@/lib/strategy/sentence';
import { parseStrategy, type StrategyRule } from '@/lib/strategy/types';
import { renderText } from '@/lib/watchlist/text';

const context = { config: STRATEGY_CONFIG, baseWeights: { A: 60, B: 40 } };
const cad = (price: number) => ({ price, currency: 'CAD', priceCad: price });
/** French sentences use no-break spaces; the tests read them with plain ones. */
const plain = (text: string) => text.replace(/[\u00a0\u202f]/g, ' ');

/** A: 60 units at 10 CAD (600), B: 40 units at 10 CAD (400), no cash: 1000 CAD, 60 % / 40 %. */
function state(over: Partial<PortfolioState> = {}): PortfolioState {
    return {
        dayIndex: 10, date: '2022-03-15', previousDate: '2022-03-14', cashCad: 0,
        positions: { A: 60, B: 40 }, prices: { A: cad(10), B: cad(10), DEF: cad(20) },
        peakValueCad: 1000, lastFiredDay: {}, guardActive: {}, spent: {},
        ...over,
    };
}
const rulesOf = (...rules: unknown[]): StrategyRule[] => {
    const parsed = parseStrategy({ name: 'test', rules });
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    return parsed.strategy.rules;
};

describe('the constants come from rules/v1.json', () => {
    it('priority, anti-oscillation delay and minimum order', () => {
        expect(STRATEGY_CONFIG).toMatchObject({ priority: ['drawdown_guard', 'weight_cap', 'allocation_target', 'periodic_purchase', 'price_threshold'], antiOscillationTradingDays: 5, minOrderCad: 25 });
    });
});

describe('weight_cap', () => {
    it('does nothing at the cap itself, and trims the excess to the cap one notch under', () => {
        expect(evaluateRules(state(), rulesOf({ kind: 'weight_cap', maxWeightPct: 60 }), context).events).toEqual([]);
        // Cap 50 %: A is at 60 %, so 10 % of 1000 CAD = 100 CAD = 10 units are sold; B has room for exactly 100 CAD
        const [event] = evaluateRules(state(), rulesOf({ kind: 'weight_cap', maxWeightPct: 50, proceedsSymbol: 'B' }), context).events;
        expect(event.condition).toMatchObject({ kind: 'weight_cap', capPct: 50, met: true });
        expect(event.orders).toHaveLength(2);
        expect(event.orders[0]).toMatchObject({ symbol: 'A', side: 'sell', purpose: 'cap_trim' });
        expect(event.orders[0].quantity).toBeCloseTo(10, 9);
        expect(event.orders[1]).toMatchObject({ symbol: 'B', side: 'buy', purpose: 'cap_proceeds' });
        expect(event.orders[1].amountCad).toBeCloseTo(100, 9);
        expect(plain(renderText(eventTextRef(event), 'fr'))).toContain('A représentait 60,0 % du portefeuille (plafond : 50,0 %)');
    });
});

describe('allocation_target', () => {
    const targets = [{ symbol: 'A', weightPct: 50 }, { symbol: 'B', weightPct: 50 }];
    it('rebalances when the drift exceeds the threshold in points, not at the threshold', () => {
        // A is at 60 % for a 50 % target: 10 points of drift
        expect(evaluateRules(state(), rulesOf({ kind: 'allocation_target', targets, rebalance: { mode: 'drift', driftPts: 10 } }), context).events).toEqual([]);
        const [event] = evaluateRules(state(), rulesOf({ kind: 'allocation_target', targets, rebalance: { mode: 'drift', driftPts: 9.5 } }), context).events;
        expect(event.condition).toMatchObject({ mode: 'drift', driftOf: 'A', thresholdPts: 9.5, met: true });
        expect((event.condition as { maxDriftPts: number }).maxDriftPts).toBeCloseTo(10, 9);
        expect(event.orders.map((o) => [o.symbol, o.side, Math.round(o.estValueCad * 100) / 100])).toEqual([['A', 'sell', 100], ['B', 'buy', 100]]);
    });
    it('rebalances on the first trading day of a quarter only', () => {
        const rules = rulesOf({ kind: 'allocation_target', targets, rebalance: { mode: 'quarterly' } });
        expect(evaluateRules(state({ previousDate: '2022-03-31', date: '2022-04-01' }), rules, context).events).toHaveLength(1);
        expect(evaluateRules(state({ previousDate: '2022-04-01', date: '2022-04-04' }), rules, context).events).toEqual([]);
        expect(evaluateRules(state({ previousDate: undefined, date: '2022-04-01' }), rules, context).events).toEqual([]);
    });
});

describe('drawdown_guard', () => {
    const rules = rulesOf({ kind: 'drawdown_guard', triggerDrawdownPct: 10, movePct: 50, defensiveSymbol: 'DEF', recoverDrawdownPct: 5 });
    it('enters past the threshold, moves the given share to the defensive symbol, and returns to target under the recovery level', () => {
        // Peak 1000. A at 8.3333 -> value 900: a fall of exactly 10 %, the threshold itself: nothing
        expect(evaluateRules(state({ prices: { A: cad(500 / 60), B: cad(10), DEF: cad(20) } }), rules, context).events).toEqual([]);
        // A at 8 -> value 880: a fall of 12 %. Half of A (30 units, 240 CAD) and half of B (20 units, 200 CAD) go to DEF (440 CAD)
        const entered = evaluateRules(state({ prices: { A: cad(8), B: cad(10), DEF: cad(20) } }), rules, context);
        const [event] = entered.events;
        expect(event).toMatchObject({ guard: 'entered', condition: { phase: 'enter', thresholdPct: 10, peakValueCad: 1000, valueCad: 880, met: true } });
        expect((event.condition as { fallPct: number }).fallPct).toBeCloseTo(12, 9);
        expect(event.orders.map((o) => [o.symbol, o.side, Math.round(o.estValueCad * 100) / 100])).toEqual([['A', 'sell', 240], ['B', 'sell', 200], ['DEF', 'buy', 440]]);
        expect(entered.next.guardActive[rules[0].id]).toBe(true);
        expect(plain(bothLanguages(eventTextRef(event, rules[0])).fr)).toContain('12,0 % sous son sommet');

        // Later, guard active: 30 A + 20 B + 22 DEF. At A = 10.5 the value is 955 (4.5 % under the peak, under 5 %): back to 60 / 40
        const after = state({ dayIndex: 30, positions: { A: 30, B: 20, DEF: 22 }, prices: { A: cad(10.5), B: cad(10), DEF: cad(20) }, guardActive: entered.next.guardActive, lastFiredDay: entered.next.lastFiredDay });
        const [exit] = evaluateRules(after, rules, context).events;
        expect(exit).toMatchObject({ guard: 'exited', condition: { phase: 'exit', thresholdPct: 5, valueCad: 955 } });
        // Targets: DEF is not one (sell its 22 units, 440 CAD); A 60 % of 955 = 573 (holds 315: buy 258); B 40 % = 382 (holds 200: buy 182)
        expect(exit.orders.map((o) => [o.symbol, o.side, Math.round(o.estValueCad * 100) / 100])).toEqual([['DEF', 'sell', 440], ['A', 'buy', 258], ['B', 'buy', 182]]);
    });
    it('suspends rebalancing while it is active', () => {
        const both = rulesOf(
            { kind: 'allocation_target', targets: [{ symbol: 'A', weightPct: 50 }, { symbol: 'B', weightPct: 50 }], rebalance: { mode: 'drift', driftPts: 1 } },
            { kind: 'drawdown_guard', triggerDrawdownPct: 10, movePct: 50, defensiveSymbol: 'DEF', recoverDrawdownPct: 5 },
        );
        const result = evaluateRules(state({ prices: { A: cad(8), B: cad(10), DEF: cad(20) } }), both, context);
        // The guard is second in the list but first in priority; the rebalancing rule is then suspended
        expect(result.events.map((e) => e.kind)).toEqual(['drawdown_guard']);
        expect(result.skipped).toEqual([expect.objectContaining({ kind: 'allocation_target', reason: 'suspended_by_guard' })]);
    });
});

describe('periodic_purchase', () => {
    it('adds new cash on the first trading day of a month, split by the target weights; an order under 25 CAD is dropped with its reason', () => {
        const monthly = rulesOf({ kind: 'periodic_purchase', amountCad: 100, every: { unit: 'month' } });
        expect(evaluateRules(state(), monthly, context).events).toEqual([]);                      // 14 -> 15 March: same month
        const [event] = evaluateRules(state({ previousDate: '2022-03-31', date: '2022-04-01' }), monthly, context).events;
        expect(event.contributionCad).toBe(100);
        expect(event.orders.map((o) => [o.symbol, o.side, o.amountCad])).toEqual([['A', 'buy', 60], ['B', 'buy', 40]]);

        // 50 CAD split 60 / 40: 30 CAD of A is placed, 20 CAD of B is under the 25 CAD minimum
        const small = rulesOf({ kind: 'periodic_purchase', amountCad: 50, every: { unit: 'month' } });
        const [reduced] = evaluateRules(state({ previousDate: '2022-03-31', date: '2022-04-01' }), small, context).events;
        expect(reduced.orders.map((o) => [o.symbol, o.amountCad])).toEqual([['A', 30]]);
        expect(reduced.dropped).toEqual([expect.objectContaining({ reason: 'below_min_order', values: { valueCad: 20, minOrderCad: 25 } })]);
    });
    it('fires every N trading days, counted from the start', () => {
        const rules = rulesOf({ kind: 'periodic_purchase', amountCad: 100, every: { unit: 'trading_days', n: 10 } });
        expect(evaluateRules(state({ dayIndex: 9 }), rules, context).events).toEqual([]);
        expect(evaluateRules(state({ dayIndex: 10 }), rules, context).events).toHaveLength(1);
    });
});

describe('price_threshold', () => {
    const buyBelow = { kind: 'price_threshold', symbol: 'A', trigger: { type: 'price_below', value: 10 }, action: { side: 'buy', amountCad: 500 }, once: true };
    it('does not fire at the threshold, fires one cent under it, and is refused rather than reduced when the cash is short', () => {
        const rules = rulesOf(buyBelow);
        expect(evaluateRules(state({ cashCad: 600 }), rules, context).events).toEqual([]);
        const hit = evaluateRules(state({ cashCad: 600, prices: { A: cad(9.99), B: cad(10) } }), rules, context);
        expect(hit.events[0]).toMatchObject({ condition: { price: 9.99, threshold: 10, met: true }, orders: [{ symbol: 'A', side: 'buy', amountCad: 500 }] });
        expect(hit.next.spent[rules[0].id]).toBe(true);
        const short = evaluateRules(state({ cashCad: 400, prices: { A: cad(9.99), B: cad(10) } }), rules, context);
        expect(short.events).toEqual([]);
        expect(short.skipped[0]).toMatchObject({ reason: 'orders_refused', dropped: [{ reason: 'insufficient_cash', values: { cashCad: 400, costCad: 500 } }] });
    });
    it('never sells more than is held', () => {
        const rules = rulesOf({ ...buyBelow, trigger: { type: 'price_above', value: 5 }, action: { side: 'sell', quantity: 100 } });
        expect(evaluateRules(state(), rules, context).skipped[0]).toMatchObject({ reason: 'orders_refused', dropped: [{ reason: 'insufficient_position', values: { held: 60, quantity: 100 } }] });
    });
});

describe('anti-oscillation', () => {
    it('keeps a rule that fired from firing again within 5 trading days', () => {
        const rules = rulesOf({ kind: 'weight_cap', maxWeightPct: 50 });
        const id = rules[0].id;
        expect(evaluateRules(state({ dayIndex: 14, lastFiredDay: { [id]: 10 } }), rules, context).skipped[0]).toMatchObject({ reason: 'cooldown', values: { daysSinceLast: 4, minDays: 5 } });
        expect(evaluateRules(state({ dayIndex: 15, lastFiredDay: { [id]: 10 } }), rules, context).events).toHaveLength(1);
    });
});

describe('an invalid strategy is refused with a code', () => {
    it('unknown field, value out of range, weights over 100 %, recovery not under the trigger', () => {
        const codes = (rule: unknown) => {
            const parsed = parseStrategy({ name: 'x', rules: [rule] });
            return parsed.ok ? [] : parsed.errors.map((e) => `${e.code}@${e.path}`);
        };
        expect(codes({ kind: 'weight_cap', maxWeightPct: 30, leverage: 2 })).toEqual(['unknown_field@rules.0.leverage']);
        expect(codes({ kind: 'weight_cap', maxWeightPct: 130 })).toEqual(['too_big@rules.0.maxWeightPct']);
        expect(codes({ kind: 'allocation_target', targets: [{ symbol: 'A', weightPct: 70 }, { symbol: 'B', weightPct: 40 }], rebalance: { mode: 'quarterly' } })).toEqual(['targets_over_100@rules.0.targets']);
        expect(codes({ kind: 'drawdown_guard', triggerDrawdownPct: 10, movePct: 50, defensiveSymbol: 'DEF', recoverDrawdownPct: 10 })).toEqual(['recover_not_below_trigger@rules.0.recoverDrawdownPct']);
        expect(codes({ kind: 'margin_call' })).toEqual(['not_accepted@rules.0.kind']);

        const refused = parseStrategy({ name: 'x', rules: [{ kind: 'weight_cap', maxWeightPct: 130 }] });
        expect(refused.ok).toBe(false);
        if (!refused.ok) {
            expect(refused.errors[0]).toMatchObject({ code: 'too_big', path: 'rules.0.maxWeightPct', values: { limit: 100 } });
            expect(plain(renderText(refused.errors[0].textRef, 'fr'))).toBe('rules.0.maxWeightPct : la valeur doit être d’au plus 100.');
        }
    });
});
