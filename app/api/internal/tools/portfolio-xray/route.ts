import { z } from 'zod';
import { internalTool } from '@/lib/agent/internal';
import { getPortfolioXray, getXrayWhatIf, type XrayView } from '@/lib/services/portfolio-xray';
import { agentFigures } from '@/lib/xray/figures';
import type { WindowId } from '@/lib/xray/types';

const schema = z.object({
    change: z.object({
        symbol: z.string().trim().min(1).max(20),
        amountCad: z.number().positive().max(1_000_000_000),
        direction: z.enum(['add', 'reduce']),
    }).optional(),
    locale: z.enum(['en', 'fr']).optional(),
    // The one period to report (the model's report is limited, and three periods do not fit in it): whole history by default
    window: z.enum(['full', 'last3y', 'last1y']).default('full'),
});

// For the model: one window only, the chart's curve is left out (150 points it does not need), and the headline figures are
// repeated as sourced values so a reply that states one can cite where it comes from.
const forAgent = (view: XrayView, only: WindowId) => ({
    ...view,
    windows: Object.fromEntries(Object.entries(view.windows).filter(([id]) => id === only).map(([id, window]) => {
        if (!window.available) return [id, window];
        return [id, Object.fromEntries(Object.entries(window).filter(([key]) => key !== 'curve'))];
    })),
    figures: agentFigures(view, view, only),
});

// The portfolio X-ray, or the X-ray before and after a hypothetical change. Read-only: nothing is traded or stored.
export const POST = internalTool(schema, async ({ change, locale, window }, _actionId, scope) => {
    if (!change) return forAgent(await getPortfolioXray(locale ?? 'en', scope), window);
    const result = await getXrayWhatIf(change, locale ?? 'en', scope);
    return { ...result, before: forAgent(result.before, window), after: forAgent(result.after, window) };
});
