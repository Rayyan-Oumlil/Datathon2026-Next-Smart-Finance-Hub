import { NextRequest } from 'next/server';
import { z } from 'zod';
import { respond } from '@/lib/services/http';
import { listAgentActions } from '@/lib/store';
import { requestScope } from '@/lib/session';

export const dynamic = 'force-dynamic';

// The action-log rows of one request of this visitor's current generation, oldest first: the web app's steps and
// the agent service's, side by side (both write under the scope id).
export const GET = (req: NextRequest) => respond(async () => {
    const actionId = z.string().min(1).max(60).parse(req.nextUrl.searchParams.get('actionId') ?? '');
    const rows = await listAgentActions((await requestScope(req)).scopeId, { actionId });
    return { rows: rows.sort((a, b) => (a.id < b.id ? -1 : 1)) };
}, req);
