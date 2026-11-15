import { z } from 'zod';
import { internalTool } from '@/lib/agent/internal';
import { getPortfolioXray, getXrayWhatIf, type XrayView } from '@/lib/services/portfolio-xray';

const schema = z.object({
    change: z.object({
        symbol: z.string().trim().min(1).max(20),
        amountCad: z.number().positive().max(1_000_000_000),
        direction: z.enum(['add', 'reduce']),
    }).optional(),
    locale: z.enum(['en', 'fr']).optional(),
});

// The chart's curve is for the screen: the model does not need 150 points per window, and every number it
// reads must be one it can cite.
const forAgent = (view: XrayView) => ({
    ...view,
    windows: Object.fromEntries(Object.entries(view.windows).map(([id, window]) => {
        if (!window.available) return [id, window];
        return [id, Object.fromEntries(Object.entries(window).filter(([key]) => key !== 'curve'))];
    })),
});

// The portfolio X-ray, or the X-ray before and after a hypothetical change. Read-only: nothing is traded or stored.
export const POST = internalTool(schema, async ({ change, locale }) => {
    if (!change) return forAgent(await getPortfolioXray(locale ?? 'en'));
    const result = await getXrayWhatIf(change, locale ?? 'en');
    return { ...result, before: forAgent(result.before), after: forAgent(result.after) };
});
