import { NextRequest } from 'next/server';
import { z } from 'zod';
import { respond } from '@/lib/services/http';
import { getReplay, runReplay } from '@/lib/services/replay';
import { requestScope } from '@/lib/session';
import { strategyProblems } from '../strategy/problems';

export const dynamic = 'force-dynamic';

// A replay of the time machine: illustrative, on the frozen snapshot, never a real order. Body: { portfolio, capitalCad, strategy, startDate, feePerOrderCad }
export const POST = (req: NextRequest) => respond(async () => strategyProblems(req, async () => ({ replay: await runReplay(await req.json(), { scope: await requestScope(req) }) })), req);

// A replay run earlier in this process, by id: GET /api/replay?id=rp_...
export const GET = (req: NextRequest) => respond(async () => {
    const { id } = z.object({ id: z.string().min(1).max(40) }).parse({ id: req.nextUrl.searchParams.get('id') ?? '' });
    return { replay: getReplay(id) };
}, req);
