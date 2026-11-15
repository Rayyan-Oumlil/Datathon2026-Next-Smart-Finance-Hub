import { z } from 'zod';
import { internalTool } from '@/lib/agent/internal';
import { getPortfolio } from '@/lib/services/portfolio';

const LAST_TRADES = 20;

export const POST = internalTool(z.object({}), async () => {
    const { portfolio, valueCad, cashCad, positions, bySector, dayChangeCad, fxUsdCad, unpriced, simulated } = await getPortfolio();
    // The prompt gets the latest trades only; the full list stays in the decision log
    const trades = portfolio.trades.slice(-LAST_TRADES);
    return { portfolio: { ...portfolio, trades }, tradesTotal: portfolio.trades.length, valueCad, cashCad, positions, bySector, dayChangeCad, fxUsdCad, unpriced, simulated };
});
