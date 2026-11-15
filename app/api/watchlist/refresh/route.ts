import type { NextRequest } from 'next/server';
import { requestLocale, respond } from '@/lib/services/http';
import { refreshWatchlist } from '@/lib/services/watchlist';
import { requestScope } from '@/lib/session';

// Once a day: { started: false, reason } when today's run for the current profile already exists (reason in the request's language)
export const POST = (req: NextRequest) => respond(async () => refreshWatchlist(await requestLocale(req), await requestScope(req)), req);
