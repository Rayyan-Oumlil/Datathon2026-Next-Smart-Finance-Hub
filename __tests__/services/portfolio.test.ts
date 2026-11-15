import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_USER } from '@/lib/demo-user';
import type { SimulatedTrade } from '@/lib/domain/types';
import { listDecisions } from '@/lib/store';
import { getEntry } from '@/lib/universe';
import { RULES, RULES_VERSION } from '@/lib/rules';
import { getPortfolio, getPortfolioState, holdingsSummary, holdingsWithDetail, replayTrades, resetPortfolioCache, simulateTrade } from '@/lib/services/portfolio';
import { freshWorld, market, sourced } from './helpers';

vi.mock('@/lib/services/quotes', async (original) => (await import('./market-stub')).quotesMock(await original()));

beforeEach(() => freshWorld());

const filled = async (input: Parameters<typeof simulateTrade>[0]) => {
    const outcome = await simulateTrade(input);
    if (outcome.status !== 'filled') throw new Error('expected a fill');
    return outcome;
};

describe('replayTrades', () => {
    const trade = (symbol: string, side: 'buy' | 'sell', quantity: number, valueCad: number): SimulatedTrade =>
        ({ id: 't', at: '2026-11-13T15:00:00.000Z', symbol, side, quantity, price: sourced(1), currency: 'CAD', valueCad, origin: 'card', reason: '', simulated: true });

    it('starts with the cash of the rules file and no position', () => {
        expect(replayTrades([])).toEqual({ cashCad: 10000, startingCashCad: 10000, positions: [], trades: [] });
    });

    it('averages the cost on purchases only and drops a position reduced to zero', () => {
        // 10 @ 142 = 1420, then 4 out for 624.80, then 4 in for 624.80: 10 units costing 6 x 142 + 624.80 = 1476.80
        const trades = [trade('AAPL', 'buy', 10, 1420), trade('AAPL', 'sell', 4, 624.8), trade('AAPL', 'buy', 4, 624.8), trade('RY.TO', 'buy', 20, 1000), trade('RY.TO', 'sell', 20, 1100)];
        const portfolio = replayTrades(trades);
        expect(portfolio.cashCad).toBe(8680);       // 10000 - 1420 + 624.80 - 624.80 - 1000 + 1100
        expect(portfolio.positions).toEqual([expect.objectContaining({ symbol: 'AAPL', quantity: 10, sector: getEntry('AAPL')!.sector, assetClass: 'stock' })]);
        expect(portfolio.positions[0].avgCostCad).toBeCloseTo(147.68, 10);
    });
});

describe('simulateTrade', () => {
    it('converts a USD price to CAD with the Bank of Canada rate and logs the trade', async () => {
        const { trade, portfolio } = await filled({ symbol: 'aapl', side: 'buy', amountCad: 1420 });      // 100 USD x 1.42 = 142 CAD a unit
        expect(trade).toMatchObject({ symbol: 'AAPL', side: 'buy', quantity: 10, valueCad: 1420, currency: 'USD', origin: 'card', simulated: true });
        expect(trade.price).toMatchObject({ value: 100, source: 'stub quotes', fetchedAt: expect.any(String) });
        expect(portfolio.cashCad).toBe(8580);

        const [logged] = await listDecisions(DEMO_USER.id, { kind: 'simulated_trade' });
        expect(logged).toMatchObject({ symbol: 'AAPL', payload: { trade: { id: trade.id }, unitPriceCad: 142, fxUsdCad: { value: 1.42, source: 'Bank of Canada' }, cashBeforeCad: 10000, simulated: true } });
        expect(logged.ruleVersions).toEqual({ rules: RULES_VERSION, filters: RULES.filters.version });
    });

    it('values the portfolio from the log: cash, positions, return, sector split and today\'s change', async () => {
        await filled({ symbol: 'AAPL', side: 'buy', amountCad: 1420 });
        await filled({ symbol: 'RY.TO', side: 'buy', quantity: 20 });                 // 20 x 50 CAD = 1000
        market.prices.AAPL = { value: 110, currency: 'USD', change: 10 };
        await filled({ symbol: 'AAPL', side: 'sell', quantity: 4 });                  // 4 x 110 x 1.42 = 624.80

        resetPortfolioCache();      // what follows comes from the decision log alone
        const view = await getPortfolio();
        expect(view.cashCad).toBe(8204.8);
        expect(view.simulated).toBe(true);
        const [aapl, ry] = view.positions;
        expect(aapl).toMatchObject({ symbol: 'AAPL', quantity: 6, avgCostCad: 142, valueCad: 937.2, returnPct: 10 });      // 6 x 156.20
        expect(ry).toMatchObject({ symbol: 'RY.TO', quantity: 20, avgCostCad: 50, valueCad: 1000, returnPct: 0 });
        expect(view.valueCad).toMatchObject({ value: 10142, currency: 'CAD', source: 'derived' });                          // 8204.80 + 937.20 + 1000
        expect(view.valueCad.note).toContain('1.42 CAD per USD (Bank of Canada');
        expect(view.bySector).toEqual({ [getEntry('AAPL')!.sector!]: 937.2, [getEntry('RY.TO')!.sector!]: 1000 });
        expect(view.dayChangeCad).toBe(85.2);                                         // 937.20 - 937.20 / 1.10; RY.TO unchanged
        expect(view.portfolio.trades).toHaveLength(3);
        expect(view.history[0]).toEqual({ t: view.portfolio.trades[0].at, valueCad: 10000 });
        expect(view.history[view.history.length - 1].valueCad).toBe(10142);

        expect(await holdingsSummary()).toEqual({
            totalValueCad: 10142,
            bySector: view.bySector,
            byAssetClass: { stock: 1937.2 },
            symbols: ['AAPL', 'RY.TO'],
        });
    });

    it('shows a missing price as missing and leaves it out of the total', async () => {
        await filled({ symbol: 'RY.TO', side: 'buy', quantity: 20 });
        market.prices['RY.TO'] = undefined;
        const view = await getPortfolio();
        expect(view.positions[0]).toMatchObject({ price: null, valueCad: null, returnPct: null });
        expect(view.unpriced).toEqual(['RY.TO']);
        expect(view.valueCad.value).toBe(9000);
        expect(view.valueCad.note).toContain('not included, no price available: RY.TO');
        expect(view.dayChangeCad).toBeNull();
    });

    it('says which positions of the holdings summary are valued at cost for want of a price', async () => {
        await filled({ symbol: 'AAPL', side: 'buy', amountCad: 1420 });
        await filled({ symbol: 'RY.TO', side: 'buy', quantity: 20 });
        market.prices['RY.TO'] = undefined;
        const { summary, detail } = await holdingsWithDetail();
        expect(summary.totalValueCad).toBe(10000);       // 7580 cash + 1420 at the last price + 1000 at cost
        expect(detail).toEqual([
            { symbol: 'AAPL', quantity: 10, price: expect.objectContaining({ value: 100, currency: 'USD' }), valuedAt: 'last price', fxUsdCad: expect.objectContaining({ value: 1.42, source: 'Bank of Canada' }) },
            { symbol: 'RY.TO', quantity: 20, price: null, valuedAt: 'average cost (no price available)', fxUsdCad: null },
        ]);
        expect(await holdingsSummary()).toEqual(summary);
    });

    it('refuses without a sourced price, without the rate, beyond the cash, beyond the position, and for reference assets', async () => {
        market.prices.MSFT = undefined;
        await expect(simulateTrade({ symbol: 'MSFT', side: 'buy', amountCad: 100 })).rejects.toMatchObject({ status: 502 });
        market.fx = null;
        await expect(simulateTrade({ symbol: 'AAPL', side: 'buy', amountCad: 100 })).rejects.toMatchObject({ status: 502 });
        market.fx = 1.42;
        await expect(simulateTrade({ symbol: 'AAPL', side: 'buy', amountCad: 10000.01 })).rejects.toMatchObject({ status: 400 });
        await expect(simulateTrade({ symbol: 'AAPL', side: 'sell', quantity: 1 })).rejects.toMatchObject({ status: 400 });
        await expect(simulateTrade({ symbol: 'GOLD', side: 'buy', amountCad: 100 })).rejects.toMatchObject({ status: 400 });
        await expect(simulateTrade({ symbol: 'CA5Y', side: 'buy', amountCad: 100 })).rejects.toMatchObject({ status: 400 });
        await expect(simulateTrade({ symbol: 'NOPE', side: 'buy', amountCad: 100 })).rejects.toMatchObject({ status: 404 });
        await expect(simulateTrade({ symbol: 'AAPL', side: 'buy' })).rejects.toMatchObject({ status: 400 });
        await expect(simulateTrade({ symbol: 'AAPL', side: 'buy', amountCad: 100, quantity: 1 })).rejects.toMatchObject({ status: 400 });
        expect(await listDecisions(DEMO_USER.id, { kind: 'simulated_trade' })).toEqual([]);
        expect((await getPortfolioState()).cashCad).toBe(10000);
    });

    it('never spends more than the amount given, and an amount equal to a whole position removes all of it', async () => {
        market.prices.BTC = { value: 90000.07, currency: 'CAD' };
        const { trade, portfolio, unitPriceCad, fxUsdCad } = await filled({ symbol: 'RY.TO', side: 'buy', amountCad: 10000 });
        expect(portfolio.cashCad).toBe(0);
        expect({ quantity: trade.quantity, unitPriceCad, fxUsdCad }).toEqual({ quantity: 200, unitPriceCad: 50, fxUsdCad: null });
        market.prices['RY.TO'] = { value: 33.33, currency: 'CAD' };
        const out = await filled({ symbol: 'RY.TO', side: 'sell', amountCad: 6666 });           // 200 x 33.33
        expect(out.portfolio.positions).toEqual([]);
        expect(out.portfolio.cashCad).toBe(6666);
        const btc = await filled({ symbol: 'BTC', side: 'buy', amountCad: 6666, acknowledgeConflict: true });
        expect(btc.trade.valueCad).toBeLessThanOrEqual(6666);
        expect(btc.trade.valueCad).toBeGreaterThan(6665.9);
    });

    it('states the Bank of Canada rate a USD price was converted with', async () => {
        const { unitPriceCad, fxUsdCad } = await filled({ symbol: 'AAPL', side: 'buy', amountCad: 1420 });
        expect(unitPriceCad).toBe(142);
        expect(fxUsdCad).toMatchObject({ value: 1.42, source: 'Bank of Canada', asOf: '2026-11-13', fetchedAt: expect.any(String) });
    });

    it('does not let two requests at once spend the same cash', async () => {
        const results = await Promise.allSettled([
            simulateTrade({ symbol: 'RY.TO', side: 'buy', amountCad: 6000 }),
            simulateTrade({ symbol: 'RY.TO', side: 'buy', amountCad: 6000 }),
        ]);
        expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
        expect((await getPortfolioState()).cashCad).toBe(4000);
    });
});

describe('profile conflict', () => {
    beforeEach(() => {
        market.signals.AAPL = { volatility1y: sourced(0.5, { source: 'derived' }) };      // above the 35% cap of Medium
    });

    it('names the conflict with the actual values and simulates nothing until acknowledged', async () => {
        const outcome = await simulateTrade({ symbol: 'AAPL', side: 'buy', amountCad: 1420 });
        if (outcome.status !== 'conflict') throw new Error('expected a conflict');
        expect(outcome.conflicts).toEqual([expect.objectContaining({ filter: 'volatility', pass: false, value: 0.5, limit: 0.35 })]);
        expect(outcome.message).toContain('50.0%');
        expect(outcome.message).toContain('35.0%');
        expect(outcome.signals.symbol).toBe('AAPL');
        expect(await listDecisions(DEMO_USER.id, { kind: 'simulated_trade' })).toEqual([]);
        const [conflict] = await listDecisions(DEMO_USER.id, { kind: 'profile_conflict' });
        expect(conflict).toMatchObject({ symbol: 'AAPL', payload: { acknowledged: false, proceeded: false, risk: 'Medium', conflicts: [{ filter: 'volatility' }] } });
        expect(conflict.ruleVersions).toEqual({ rules: RULES_VERSION, filters: RULES.filters.version, level: 'level-v1', risk: 'risk-v1' });
    });

    it('logs no conflict for a purchase the cash cannot cover', async () => {
        await expect(simulateTrade({ symbol: 'AAPL', side: 'buy', amountCad: 20000, acknowledgeConflict: true })).rejects.toMatchObject({ status: 400 });
        expect(await listDecisions(DEMO_USER.id, { kind: 'profile_conflict' })).toEqual([]);
    });

    it('proceeds in simulation when acknowledged, logging both the conflict and the trade', async () => {
        const { trade, conflicts } = await filled({ symbol: 'AAPL', side: 'buy', amountCad: 1420, acknowledgeConflict: true });
        expect(conflicts).toHaveLength(1);
        expect(trade.reason).toContain('profile conflict logged: volatility');
        const [conflict] = await listDecisions(DEMO_USER.id, { kind: 'profile_conflict' });
        expect(conflict.payload).toMatchObject({ acknowledged: true, proceeded: true });
        const [logged] = await listDecisions(DEMO_USER.id, { kind: 'simulated_trade' });
        expect(logged.payload).toMatchObject({ conflictDecisionId: conflict.id, conflicts: [{ filter: 'volatility' }] });
    });

    it('does not check a position reduction', async () => {
        market.signals = {};
        await filled({ symbol: 'AAPL', side: 'buy', quantity: 2 });
        market.signals.AAPL = { volatility1y: sourced(0.5, { source: 'derived' }) };
        await filled({ symbol: 'AAPL', side: 'sell', quantity: 1 });
        expect(await listDecisions(DEMO_USER.id, { kind: 'profile_conflict' })).toEqual([]);
    });
});
