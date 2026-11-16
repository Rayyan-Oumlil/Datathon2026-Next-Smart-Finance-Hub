import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RULES } from '@/lib/rules';
import { applyModelPortfolio, getModelPortfolios } from '@/lib/services/model-portfolio';
import { getPortfolio, getPortfolioState, resetPortfolioCache, setStartingCash, simulateTrade } from '@/lib/services/portfolio';
import { freshWorld, market } from './helpers';

vi.mock('@/lib/services/quotes', async (original) => (await import('./market-stub')).quotesMock(await original()));

beforeEach(() => freshWorld());

// The test market only knows a few symbols: give every line of the option a price, so the purchases can be filled
const firstOption = async () => {
    const option = (await getModelPortfolios('en')).options[0];
    for (const line of option.lines) market.prices[line.symbol] = { value: 100, currency: 'CAD', change: 0 };
    return option.id;
};

describe('the amount a portfolio starts with', () => {
    it('is the rules file starting cash when none was chosen', async () => {
        expect(await getPortfolioState()).toMatchObject({ cashCad: RULES.simulated_portfolio.starting_cash, startingCashCad: RULES.simulated_portfolio.starting_cash });
    });

    it('is what the owner picks: 3 000 invested means a portfolio of 3 000, not 3 000 plus 7 000 of cash', async () => {
        await applyModelPortfolio({ optionId: await firstOption(), amountCad: 3000 });
        const state = await getPortfolioState();
        expect(state.startingCashCad).toBe(3000);
        const invested = state.positions.reduce((sum, position) => sum + position.quantity * position.avgCostCad, 0);
        expect(state.cashCad).toBeLessThan(1);                                   // a few cents of rounding, never thousands
        expect(state.cashCad + invested).toBeCloseTo(3000, 1);
    });

    it('survives a restart of the process: it is read back from the log', async () => {
        await applyModelPortfolio({ optionId: await firstOption(), amountCad: 3000 });
        resetPortfolioCache();                                                   // the in-memory copies are gone
        expect((await getPortfolioState()).startingCashCad).toBe(3000);
    });

    it('is the baseline of the performance view, so a 3 000 portfolio does not look like a loss of 7 000', async () => {
        await applyModelPortfolio({ optionId: await firstOption(), amountCad: 3000 });
        const view = await getPortfolio('en');
        expect(view.portfolio.startingCashCad).toBe(3000);
        expect(view.history[0].valueCad).toBe(3000);
    });

    it('can still be 10 000, the largest amount, and refuses more or less than the limits', async () => {
        const id = await firstOption();
        await expect(applyModelPortfolio({ optionId: id, amountCad: 10_001 })).rejects.toThrow(/between/);
        await expect(applyModelPortfolio({ optionId: id, amountCad: 100 })).rejects.toThrow(/between/);
        await applyModelPortfolio({ optionId: id, amountCad: 10_000 });
        expect((await getPortfolioState()).startingCashCad).toBe(10_000);
    });

    it('cannot change once the portfolio has a trade', async () => {
        await applyModelPortfolio({ optionId: await firstOption(), amountCad: 3000 });
        await expect(setStartingCash(5000)).rejects.toThrow(/already has trades/);
    });

    it('a trade can spend the cash that is left and no more', async () => {
        await applyModelPortfolio({ optionId: await firstOption(), amountCad: 3000 });
        const outcome = await simulateTrade({ symbol: 'AAPL', side: 'buy', amountCad: 5000, origin: 'card', acknowledgeConflict: true }, 'en').catch((error) => error);
        expect(outcome instanceof Error || outcome.status !== 'filled').toBe(true);   // 5 000 is more than the 0.10 left of 3 000
    });

    it('offers amounts up to the starting cash, also before any portfolio exists', async () => {
        const view = await getModelPortfolios('en');
        expect(view.maxAmountCad).toBe(RULES.simulated_portfolio.starting_cash);
        expect(view.minAmountCad).toBeGreaterThan(0);
    });
});
