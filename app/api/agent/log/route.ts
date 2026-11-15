import { NextRequest } from 'next/server';
import { z } from 'zod';
import { DEMO_USER } from '@/lib/demo-user';
import { respond } from '@/lib/services/http';
import { listAgentActions } from '@/lib/store';

export const dynamic = 'force-dynamic';

// The action-log rows of one request, oldest first: the web app's steps and the agent service's, side by side.
export const GET = (req: NextRequest) => respond(async () => {
    const actionId = z.string().min(1).max(60).parse(req.nextUrl.searchParams.get('actionId') ?? '');
    const rows = await listAgentActions(DEMO_USER.id, { actionId });
    return { rows: rows.sort((a, b) => (a.id < b.id ? -1 : 1)) };
});
