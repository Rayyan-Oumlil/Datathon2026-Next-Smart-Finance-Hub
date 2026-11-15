import { NextRequest } from 'next/server';
import { respond } from '@/lib/services/http';
import { runSensitivity } from '@/lib/services/replay';
import { requestScope } from '@/lib/session';
import { strategyProblems } from '../../strategy/problems';

export const dynamic = 'force-dynamic';

// Same body as POST /api/replay. Each variant has its own replay id (GET /api/replay?id=... returns its full result).
export const POST = (req: NextRequest) => respond(async () => strategyProblems(req, async () => ({ sensitivity: await runSensitivity(await req.json(), { scope: await requestScope(req) }) })), req);
