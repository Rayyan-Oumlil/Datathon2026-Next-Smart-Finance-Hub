import { NextRequest } from 'next/server';
import { z } from 'zod';
import { respond } from '@/lib/services/http';
import { listStrategies, removeStrategy, saveStrategy } from '@/lib/services/rules-engine';
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

// Removes one of the visitor's strategies: DELETE /api/strategy?id=strat_... The removal is recorded in the decision log.
export const DELETE = (req: NextRequest) => respond(async () => {
    const id = z.string().min(1).max(100).parse(req.nextUrl.searchParams.get('id'));
    return { ok: true, removed: await removeStrategy(id, await requestScope(req)) };
}, req);
