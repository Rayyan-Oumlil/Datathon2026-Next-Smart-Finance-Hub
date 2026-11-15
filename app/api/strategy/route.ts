import { NextRequest } from 'next/server';
import { z } from 'zod';
import { respond } from '@/lib/services/http';
import { listStrategies, saveStrategy } from '@/lib/services/rules-engine';
import { requestScope } from '@/lib/session';
import { strategyProblems } from './problems';

export const dynamic = 'force-dynamic';

// The current visitor's strategies (named sets of rules). Simulation only.
export const GET = (req: NextRequest) => respond(async () => ({ strategies: await listStrategies(await requestScope(req)) }), req);

// Creates a strategy, or updates the stored one when `strategy.id` is one of the visitor's. Body: { strategy }
export const POST = (req: NextRequest) => respond(async () => strategyProblems(req, async () => {
    const { strategy } = z.object({ strategy: z.unknown() }).parse(await req.json());
    return { strategy: await saveStrategy(strategy, await requestScope(req)) };
}), req);
