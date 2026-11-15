import { z } from 'zod';
import { internalTool } from '@/lib/agent/internal';
import { ServiceError } from '@/lib/services/errors';
import { getPortfolioState } from '@/lib/services/portfolio';
import { computeStat } from '@/lib/services/portfolio-stats';

const schema = z.object({
    metric: z.enum(['return', 'drawdown', 'correlation']),
    symbols: z.array(z.string().trim().min(1).max(20)).max(10).optional(),
    period: z.enum(['1m', '3m', '1y']),
});

// Fixed calculators on daily closes. Without symbols, the held positions are used, one result per symbol:
// no calculator exists for the simulated portfolio as a whole, so no such figure is returned.
export const POST = internalTool(schema, async ({ metric, symbols, period }) => {
    const wanted = symbols?.length ? symbols : (await getPortfolioState()).positions.map((position) => position.symbol);
    if (metric === 'correlation') return computeStat({ metric, symbols: wanted, period });
    if (wanted.length === 0) throw new ServiceError(400, 'The simulated portfolio holds no position; name a symbol.');
    if (wanted.length === 1) return computeStat({ metric, symbols: wanted, period });
    const perSymbol = await Promise.all(wanted.map((symbol) => computeStat({ metric, symbols: [symbol], period })));
    return {
        metric, period, symbols: wanted, result: null,
        method: `${perSymbol[0].method}. Computed per symbol; a figure for the whole simulated portfolio is not computed.`,
        perSymbol, sources: perSymbol.flatMap((stat) => stat.sources),
    };
});
