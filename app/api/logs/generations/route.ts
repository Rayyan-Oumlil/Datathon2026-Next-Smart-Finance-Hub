import { NextRequest } from 'next/server';
import { respond } from '@/lib/services/http';
import { getSession } from '@/lib/session';
import { sessionGenerations } from '../generations';

export const dynamic = 'force-dynamic';

// The visitor's own generations (current first, then the earlier ones a reset left behind), for the /logs selector.
export const GET = (req: NextRequest) => respond(async () => {
    const { sessionId } = await getSession(req);
    return { generations: await sessionGenerations(sessionId) };
}, req);
