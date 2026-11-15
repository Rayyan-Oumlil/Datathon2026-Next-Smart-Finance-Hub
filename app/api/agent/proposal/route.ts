import type { NextRequest } from 'next/server';
import { PROPOSAL_PAGES, pendingProposal } from '@/lib/agent/proposal';
import { ServiceError } from '@/lib/services/errors';
import { respond } from '@/lib/services/http';
import { requestScope } from '@/lib/session';

export const dynamic = 'force-dynamic';

// The change the agent proposed for a page that still waits for Save: { proposal: null } when there is none.
export const GET = (req: NextRequest) => respond(async () => {
    const page = req.nextUrl.searchParams.get('page') ?? '';
    const known = PROPOSAL_PAGES.find((candidate) => candidate === page);
    if (!known) throw new ServiceError(400, 'page must be one of ' + PROPOSAL_PAGES.join(', '));
    return { proposal: await pendingProposal(known, await requestScope(req)) };
}, req);
