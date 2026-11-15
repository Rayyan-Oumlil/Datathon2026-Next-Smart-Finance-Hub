import { NextRequest } from 'next/server';
import { z } from 'zod';
import { respond } from '@/lib/services/http';
import { evaluateStrategyLive } from '@/lib/services/rules-engine';
import { requestScope } from '@/lib/session';

export const dynamic = 'force-dynamic';

// What a stored strategy would ask for on the simulated portfolio right now. On request only; nothing is executed. Body: { strategyId }
export const POST = (req: NextRequest) => respond(async () => {
    const { strategyId } = z.object({ strategyId: z.string().min(1).max(40) }).parse(await req.json());
    return { check: await evaluateStrategyLive(strategyId, await requestScope(req)) };
}, req);
