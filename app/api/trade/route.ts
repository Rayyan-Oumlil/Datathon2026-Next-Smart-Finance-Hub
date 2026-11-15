import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requestLocale, respond } from '@/lib/services/http';
import { simulateTrade } from '@/lib/services/portfolio';
import { requestScope } from '@/lib/session';

const schema = z.object({
    symbol: z.string().trim().min(1).max(20),
    side: z.enum(['buy', 'sell']),
    amountCad: z.number().positive().optional(),
    quantity: z.number().positive().optional(),
    // Only a card trade comes through this public route; the agent router and the rules engine call the service directly
    origin: z.enum(['card']).default('card'),
    acknowledgeConflict: z.boolean().optional(),
});

// Simulation only. 409 names the profile conflict with the actual values; resending with acknowledgeConflict proceeds.
// Messages and conflict details follow the request's language.
export const POST = (req: NextRequest) => respond(async () => {
    const outcome = await simulateTrade(schema.parse(await req.json()), await requestLocale(req), await requestScope(req));
    if (outcome.status === 'conflict') {
        const { conflicts, signals, message } = outcome;
        return NextResponse.json({ conflicts, signals, message }, { status: 409 });
    }
    const { trade, portfolio, conflicts, unitPriceCad, fxUsdCad } = outcome;
    // fxUsdCad is the Bank of Canada rate a USD price was converted with; null for a price already in CAD
    return { trade, portfolio, conflicts, unitPriceCad, fxUsdCad, simulated: true };
}, req);
