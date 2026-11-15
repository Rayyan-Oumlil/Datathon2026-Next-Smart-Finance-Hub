import type { NextRequest } from 'next/server';
import { requestLocale, respond } from '@/lib/services/http';
import { getWatchlist } from '@/lib/services/watchlist';
import { requestScope } from '@/lib/session';

export const dynamic = 'force-dynamic';

// Never waits on a build: with no run for today it starts one and answers building: true.
// Every sentence is in the request's language, re-rendered from the logged run whatever language it was computed in.
export const GET = (req: NextRequest) => respond(async () => getWatchlist(await requestLocale(req), await requestScope(req)), req);
