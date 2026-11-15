// The live app and the replay share ONE rules evaluator: the same rule on the same portfolio state gives the same
// event through both entry points. Also the replay service and the strategy routes.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { TEST_SCOPE } from '@/__tests__/test-user';
import { GET as STRATEGIES, POST as SAVE_STRATEGY } from '@/app/api/strategy/route';
import { POST as REPLAY } from '@/app/api/replay/route';
import { listScopeDecisions } from '@/lib/session';
import { simulateTrade } from '@/lib/services/portfolio';
import { getReplay, resetReplayCache, runReplay, runSensitivity } from '@/lib/services/replay';
import { StrategyInvalidError, createRule, evaluateLiveRules, evaluateStrategyLive, saveStrategy } from '@/lib/services/rules-engine';
import { fromInvestmentRule } from '@/lib/strategy/types';
import { freshWorld, market } from '../../services/helpers';
import { fixtureProvider, syntheticMarket, weekdays } from './fixtures/provider';

vi.mock('@/lib/services/quotes', async (original) => (await import('../../services/market-stub')).quotesMock(await original()));

beforeEach(async () => {
    await freshWorld();
    resetReplayCache();
});

const post = (url: string, body: unknown) => new NextRequest(url, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', 'accept-language': 'fr' } });

describe('one evaluator for the live app and the replay', () => {
    it('gives the same event for the same rule on the same state', async () => {
        // Live: 10 000 CAD, half put in RY.TO at 50 CAD (100 units, 5 000 CAD of cash); AAPL at 98.20 USD, 1 USD = 1.42 CAD
        await simulateTrade({ symbol: 'RY.TO', side: 'buy', amountCad: 5000 }, 'en', TEST_SCOPE);
        const rule = await createRule({ text: 'add 500 CAD of AAPL under 100', symbol: 'AAPL', trigger: { type: 'price_below', value: 100 }, action: { side: 'buy', amountCad: 500 }, once: true }, TEST_SCOPE);
        market.prices.AAPL = { value: 98.2, currency: 'USD' };
        const live = await evaluateLiveRules(TEST_SCOPE);
        expect(live.state).toMatchObject({ cashCad: 5000, positions: { 'RY.TO': 100 } });
        const [liveEvent] = live.evaluation.events;

        // Replay: the same portfolio and prices on day 1, the same rule
        const dates = weekdays('2024-03-04', 3);
        const provider = fixtureProvider({ dates, usdcad: [1.42, 1.42, 1.42], assets: { 'RY.TO': { currency: 'CAD', prices: [50, 50, 50] }, AAPL: { currency: 'USD', prices: [98.2, 98.2, 98.2] } } });
        const strategy = { id: 'live-rules', name: 'the live rule', version: 1, rules: [fromInvestmentRule(rule)] };
        const replay = await runReplay({ portfolio: [{ symbol: 'RY.TO', weightPct: 50 }], capitalCad: 10_000, strategy, startDate: dates[0] }, { provider, scope: TEST_SCOPE });
        const [replayEvent] = replay.ruleEvents;

        expect(replayEvent.decisionDay).toBe(dates[0]);
        expect({ ruleId: replayEvent.ruleId, ruleVersion: replayEvent.ruleVersion, kind: replayEvent.kind, condition: replayEvent.condition, orders: replayEvent.proposedOrders })
            .toEqual({ ruleId: liveEvent.ruleId, ruleVersion: liveEvent.ruleVersion, kind: liveEvent.kind, condition: liveEvent.condition, orders: liveEvent.orders });
        expect(liveEvent).toMatchObject({ ruleId: rule.id, condition: { price: 98.2, threshold: 100, currency: 'USD', met: true }, orders: [{ symbol: 'AAPL', side: 'buy', amountCad: 500 }] });
        // The replay fills it on the next day; the live app fills it now through the simulated portfolio
        const filled = replay.orders.find((o) => o.ruleId === rule.id)!;
        expect(filled).toMatchObject({ decisionDay: dates[0], executionDay: dates[1], side: 'buy', symbol: 'AAPL', usdcad: 1.42 });
        expect(filled.valueCad).toBeCloseTo(500, 9);
        expect(filled.priceCad).toBeCloseTo(139.444, 9);
    });
});

describe('the replay service', () => {
    const provider = fixtureProvider(syntheticMarket());
    const input = {
        portfolio: [{ symbol: 'GROW', weightPct: 60 }, { symbol: 'SAFE', weightPct: 40 }], capitalCad: 5000, startDate: '2021-12-01',
        strategy: { name: 'cap', rules: [{ kind: 'weight_cap', maxWeightPct: 62 }] },
    };

    it('caches a result under its replay id and logs each run and each sensitivity variant', async () => {
        const first = await runReplay(input, { provider, scope: TEST_SCOPE });
        expect(await runReplay(input, { provider, scope: TEST_SCOPE })).toEqual(first);
        expect(getReplay(first.replayId)).toEqual(first);
        expect(first.params.feePerOrderCad).toBe(0);

        const report = await runSensitivity(input, { provider, scope: TEST_SCOPE });
        expect(report.baseReplayId).toBe(first.replayId);
        expect(report.variants.length).toBe(4);                                    // base, two other start dates, one threshold
        for (const variant of report.variants) expect(getReplay(variant.replayId).replayId).toBe(variant.replayId);

        const rows = (await listScopeDecisions(TEST_SCOPE)).filter((row) => row.kind === 'replay_run');
        expect(rows.map((row) => (row.payload as { run: string }).run)).toEqual(['replay', 'replay', 'sensitivity']);
        expect(rows[0]).toMatchObject({ snapshotId: 'fixture-1', payload: { origin: 'replay', replayId: first.replayId, simulated: true } });
        expect((rows[2].payload as { variants: unknown[] }).variants).toHaveLength(4);
    });

    it('refuses an invalid strategy with a code, in French on the routes', async () => {
        await expect(runReplay({ ...input, strategy: { name: 'x', rules: [{ kind: 'weight_cap', maxWeightPct: 500 }] } }, { provider, scope: TEST_SCOPE })).rejects.toBeInstanceOf(StrategyInvalidError);
        await expect(saveStrategy({ name: 'x', rules: [{ kind: 'weight_cap', maxWeightPct: 30, surprise: true }] }, TEST_SCOPE)).rejects.toMatchObject({ status: 400, issues: [{ code: 'unknown_field', path: 'rules.0.surprise' }] });

        const refused = await SAVE_STRATEGY(post('http://localhost/api/strategy', { strategy: { name: 'x', rules: [{ kind: 'weight_cap', maxWeightPct: 500 }] } }));
        expect(refused.status).toBe(400);
        const body = await refused.json();
        expect(body.issues).toEqual([{ code: 'too_big', path: 'rules.0.maxWeightPct', values: { limit: 100 }, message: expect.stringContaining('la valeur doit être d’au plus 100') }]);
        const bad = await REPLAY(post('http://localhost/api/replay', { ...input, strategy: { name: 'x', rules: [{ kind: 'nope' }] } }));
        expect(bad.status).toBe(400);
        expect((await bad.json()).issues[0]).toMatchObject({ code: 'not_accepted', path: 'rules.0.kind' });
    });

    it('stores a strategy, versions it on update, and evaluates it live without executing anything', async () => {
        const created = await (await SAVE_STRATEGY(post('http://localhost/api/strategy', { strategy: { name: 'Prudente', rules: [{ kind: 'weight_cap', maxWeightPct: 40 }] } }))).json();
        expect(created.strategy).toMatchObject({ name: 'Prudente', version: 1, rules: [{ id: 'weight_cap_1', kind: 'weight_cap', version: 1, maxWeightPct: 40 }] });
        const updated = await saveStrategy({ id: created.strategy.id, name: 'Prudente', rules: [{ kind: 'weight_cap', maxWeightPct: 30 }] }, TEST_SCOPE);
        expect(updated).toMatchObject({ id: created.strategy.id, version: 2, rules: [{ version: 2, maxWeightPct: 30 }] });
        const listed = await (await STRATEGIES(new NextRequest('http://localhost/api/strategy'))).json();
        expect(listed.strategies.map((s: { id: string }) => s.id)).toEqual([created.strategy.id]);

        // 5 000 CAD of RY.TO in a 10 000 CAD portfolio: 50 %, over the 30 % cap: 2 000 CAD (40 units at 50 CAD) would be trimmed
        await simulateTrade({ symbol: 'RY.TO', side: 'buy', amountCad: 5000 }, 'en', TEST_SCOPE);
        const check = await evaluateStrategyLive(updated.id, TEST_SCOPE);
        expect(check).toMatchObject({ executed: false, simulated: true, valueCad: 10_000, events: [{ kind: 'weight_cap', orders: [{ symbol: 'RY.TO', side: 'sell', purpose: 'cap_trim' }] }] });
        expect(check.events[0].orders[0].quantity).toBeCloseTo(40, 6);
        expect(check.events[0].sentence.fr).toContain('RY.TO');
    });
});
