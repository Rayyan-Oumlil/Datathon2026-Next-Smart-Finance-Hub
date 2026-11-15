// The replay engine on a synthetic provider (same interface as the snapshot): the acceptance criteria of the brief.
import { describe, expect, it } from 'vitest';
import { ReplayError, assertReconciled, loadReplayData, runReplayOn, runSensitivityOn, type ReplayParams, type ReplayResult } from '@/lib/replay/engine';
import { parseStrategy, type Strategy } from '@/lib/strategy/types';
import { fixtureProvider, syntheticMarket, weekdays, type Fixture } from './fixtures/provider';

const strategyOf = (...rules: unknown[]): Strategy => {
    const parsed = parseStrategy({ id: 'test', name: 'test', rules });
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    return parsed.strategy;
};
const PORTFOLIO = [{ symbol: 'GROW', weightPct: 40 }, { symbol: 'SWING', weightPct: 40 }, { symbol: 'SAFE', weightPct: 20 }];
const FOUR_RULES = strategyOf(
    { kind: 'periodic_purchase', amountCad: 200, every: { unit: 'month' } },
    { kind: 'allocation_target', targets: PORTFOLIO, rebalance: { mode: 'drift', driftPts: 6 } },
    { kind: 'weight_cap', maxWeightPct: 43, proceedsSymbol: 'SAFE' },
    { kind: 'drawdown_guard', triggerDrawdownPct: 8, movePct: 50, defensiveSymbol: 'SAFE', recoverDrawdownPct: 3 },
);
const params = (over: Partial<ReplayParams> = {}): ReplayParams => ({ portfolio: PORTFOLIO, capitalCad: 10_000, strategy: FOUR_RULES, startDate: '2021-12-01', feePerOrderCad: 1.5, ...over });
const run = async (fixture: Fixture, over: Partial<ReplayParams> = {}): Promise<ReplayResult> =>
    runReplayOn(await loadReplayData(fixtureProvider(fixture), ['GROW', 'SWING', 'SAFE']), params(over));

describe('two runs of the same portfolio', () => {
    it('gives identical series when the strategy has no rule', async () => {
        const result = await run(syntheticMarket(), { strategy: strategyOf() });
        expect(result.series.with).toEqual(result.series.without);
        expect(result.gap.valueCad.every((gap) => gap === 0)).toBe(true);
        expect(result.summary).toMatchObject({ endedHigher: 'equal', identical: true, finalValueGapCad: 0, firings: [] });
        expect(result.ruleEvents).toEqual([]);
        expect(result.orders.filter((o) => o.series === 'with')).toHaveLength(3);          // the starting purchase only
    });

    it('fires every rule kind of the test strategy, and reports facts without naming a winner', async () => {
        const result = await run(syntheticMarket());
        expect(result.summary.firings.every((f) => f.count > 0)).toBe(true);
        expect(JSON.stringify(result.summary)).not.toMatch(/winner|gagnant|better|meilleur/i);
        expect(result.orders.every((o) => o.origin === 'replay' && o.snapshotId === 'fixture-1' && o.replayId === result.replayId)).toBe(true);
        expect(result.orders.every((o) => o.sentence.fr.length > 0 && o.sentence.en.length > 0)).toBe(true);
        expect(result.benchmarks.map((b) => [b.id, b.available, b.valueCad.length])).toEqual([['XIU.TO', true, result.dates.length], ['60_40', true, result.dates.length]]);
        expect(result.limitations).toEqual([expect.objectContaining({ id: 'synthetic' })]);
        expect(result.ruleContributions.map((c) => c.ruleId)).toEqual(FOUR_RULES.rules.map((r) => r.id));
    });
});

describe('signal at the close of J, execution at the price of J+1', () => {
    it('trims a holding over its cap at the next day’s price (numbers by hand)', async () => {
        // 1000 CAD, half in A at 10 CAD: 50 units and 500 CAD of cash. A doubles on day 3: 1000 of 1500 CAD = 66.7 %, over the 50 % cap.
        // Decided at the close of day 3, filled on day 4 at 20 CAD: the excess, (66.67 % - 50 %) x 1500 = 250 CAD, is 12.5 units.
        const fixture: Fixture = { dates: weekdays('2022-01-03', 5), usdcad: [1.3, 1.3, 1.3, 1.3, 1.3], assets: { A: { currency: 'CAD', prices: [10, 10, 20, 20, 20] } } };
        const data = await loadReplayData(fixtureProvider(fixture), ['A']);
        const result = runReplayOn(data, { portfolio: [{ symbol: 'A', weightPct: 50 }], capitalCad: 1000, strategy: strategyOf({ kind: 'weight_cap', maxWeightPct: 50 }), startDate: '2022-01-01', feePerOrderCad: 0 });
        expect(result.window).toEqual({ from: '2022-01-03', to: '2022-01-07', tradingDays: 5 });
        const [event] = result.ruleEvents;
        expect(event).toMatchObject({ kind: 'weight_cap', decisionDay: fixture.dates[2], executionDay: fixture.dates[3], valueAtDecisionCad: 1500, valueAfterExecutionCad: 1500 });
        const trim = result.orders.find((o) => o.id === event.orderIds[0])!;
        expect(trim).toMatchObject({ side: 'sell', symbol: 'A', priceCad: 20, feeCad: 0, valueBeforeCad: 1500, valueAfterCad: 1500, decisionDay: fixture.dates[2], executionDay: fixture.dates[3] });
        expect(trim.quantity).toBeCloseTo(12.5, 9);
        expect(trim.valueCad).toBeCloseTo(250, 9);
        expect(trim.sentence.fr).toContain(`décidé à la clôture du ${fixture.dates[2]}, exécuté au cours du ${fixture.dates[3]}`);
        expect(result.series.with.valueCad).toEqual([1000, 1000, 1500, 1500, 1500]);
        expect(result.series.with.cashCad).toEqual([500, 500, 500, 750, 750]);
        // The fixture has no XIU.TO / XBB.TO: the references are reported as missing, with the reason
        expect(result.benchmarks.map((b) => [b.available, b.reason])).toEqual([[false, 'not_in_snapshot'], [false, 'not_in_snapshot']]);
        expect(result.unreplayable.map((u) => [u.symbol, u.role, u.reason])).toEqual([['XIU.TO', 'benchmark', 'not_in_snapshot']]);
    });

    it('never looks ahead: changing the prices from day k on changes no decision and no fill before k', async () => {
        const base = syntheticMarket();
        const k = 150;
        const changed: Fixture = { ...base, assets: { ...base.assets, SWING: { ...base.assets.SWING, prices: base.assets.SWING.prices.map((p, i) => (i >= k ? p * 0.6 : p)) } } };
        const [a, b] = [await run(base), await run(changed)];
        const day = base.dates[k];
        const decisions = (r: ReplayResult) => r.ruleEvents.filter((e) => e.decisionDay < day).map((e) => ({ rule: e.ruleId, day: e.decisionDay, condition: e.condition, orders: e.proposedOrders }));
        const fills = (r: ReplayResult) => r.orders.filter((o) => o.executionDay < day);
        expect(decisions(a).length).toBeGreaterThan(3);
        expect(decisions(b)).toEqual(decisions(a));
        expect(fills(b)).toEqual(fills(a));
        expect(b.series.with.valueCad.slice(0, k)).toEqual(a.series.with.valueCad.slice(0, k));
        // ... and the change does matter from day k on
        expect(b.series.with.valueCad[k]).not.toBe(a.series.with.valueCad[k]);
    });
});

describe('reconciliation', () => {
    it('cash and units equal the capital, the contributions and the journal of orders with their fees, on every day', async () => {
        const result = await run(syntheticMarket());
        for (const series of ['without', 'with'] as const) {
            let cash = 10_000;
            const units: Record<string, number> = {};
            const orders = result.orders.filter((o) => o.series === series);
            result.dates.forEach((date, i) => {
                if (series === 'with') for (const e of result.ruleEvents.filter((x) => x.executionDay === date)) cash += e.contributionCad;
                for (const o of orders.filter((x) => x.executionDay === date)) {
                    const sign = o.side === 'buy' ? 1 : -1;
                    cash -= sign * o.valueCad + o.feeCad;
                    units[o.symbol] = (units[o.symbol] ?? 0) + sign * o.quantity;
                    expect(o.valueAfterCad).toBeCloseTo(o.valueBeforeCad - o.feeCad, 6);
                }
                expect(Math.abs(cash - result.series[series].cashCad[i])).toBeLessThan(0.006);
                expect(cash).toBeGreaterThan(-1e-6);
            });
            for (const p of result.series[series].finalPositions) expect(units[p.symbol]).toBeCloseTo(p.quantity, 6);
            expect(Object.values(units).every((q) => q > -1e-9)).toBe(true);          // no short position, ever
            // final value - capital = market effect + currency effect - fees + contributions
            const { metrics, effects } = result.series[series];
            expect(Math.abs(metrics.finalValueCad - 10_000 - (effects.marketCad + effects.currencyCad - effects.feesCad + effects.contributedCad))).toBeLessThan(0.03);
            expect(effects.feesCad).toBeCloseTo(1.5 * (metrics.orderCount + metrics.initialOrderCount), 6);
        }
        expect(result.series.with.metrics.contributedCad).toBeGreaterThan(0);
        expect(result.series.without.effects.currencyCad).not.toBe(0);              // SWING is listed in USD
    });

    it('the engine stops on a book that does not match the journal', () => {
        expect(() => assertReconciled({ cashCad: 100, positions: { A: 1 } }, { cashCad: 100, positions: { A: 1 } }, 'day')).not.toThrow();
        expect(() => assertReconciled({ cashCad: 100.01, positions: { A: 1 } }, { cashCad: 100, positions: { A: 1 } }, 'day')).toThrow(ReplayError);
        expect(() => assertReconciled({ cashCad: 100, positions: { A: 1.001 } }, { cashCad: 100, positions: {} }, 'day')).toThrow(/journal/);
    });
});

describe('determinism and sensitivity', () => {
    it('same inputs: same replay id and the same result, to the last digit; another fee: another id', async () => {
        const [a, b, c] = [await run(syntheticMarket()), await run(syntheticMarket()), await run(syntheticMarket(), { feePerOrderCad: 2 })];
        expect(b.replayId).toBe(a.replayId);
        expect(b).toEqual(a);
        expect(c.replayId).not.toBe(a.replayId);
        expect(a.replayId).toMatch(/^rp_[0-9a-f]{20}$/);
        expect((await run({ ...syntheticMarket(), id: 'fixture-2' })).replayId).not.toBe(a.replayId);
    });

    it('tests three start dates and one other threshold per rule, each with its own replay id', async () => {
        const data = await loadReplayData(fixtureProvider(syntheticMarket()), ['GROW', 'SWING', 'SAFE']);
        const { report, results } = runSensitivityOn(data, params());
        expect(report.variants.filter((v) => v.variant.type !== 'threshold').map((v) => v.window.from)).toEqual([data.calendar[0], data.calendar[75], data.calendar[150]]);
        expect(report.variants.filter((v) => v.variant.type === 'threshold').map((v) => (v.variant as { ruleId: string }).ruleId)).toEqual(FOUR_RULES.rules.map((r) => r.id));
        expect(new Set(report.variants.map((v) => v.replayId)).size).toBe(7);
        expect(results.map((r) => r.replayId)).toEqual(report.variants.map((v) => v.replayId));
        expect(report.tally.variants).toBe(7);
        expect(report.tally.withEndedHigher + report.tally.withoutEndedHigher + report.tally.equal).toBe(7);
    });

    it('leaves out a holding with no price on the first day, with the reason, and never patches it', async () => {
        const base = syntheticMarket();
        const late: Fixture = { ...base, assets: { ...base.assets, LATE: { currency: 'CAD', prices: base.dates.slice(40).map(() => 10), startAt: 40 } } };
        const data = await loadReplayData(fixtureProvider(late), ['GROW', 'LATE', 'NOPE']);
        const result = runReplayOn(data, params({ portfolio: [{ symbol: 'GROW', weightPct: 50 }, { symbol: 'LATE', weightPct: 30 }, { symbol: 'NOPE', weightPct: 20 }], strategy: strategyOf() }));
        expect(result.unreplayable.map((u) => [u.symbol, u.reason, u.date])).toEqual([['LATE', 'starts_later', base.dates[40]], ['NOPE', 'not_in_snapshot', null]]);
        expect(result.params.portfolio).toEqual([{ symbol: 'GROW', weightPct: 100 }]);
        expect(result.unreplayable[0].sentence.fr).toContain('LATE');
    });
});
