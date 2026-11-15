import type { NextRequest } from 'next/server';
import { requestLocale, respond } from '@/lib/services/http';
import { getWatchlist } from '@/lib/services/watchlist';
import { requestScope } from '@/lib/session';

export const dynamic = 'force-dynamic';

// Per-visitor data: never stored by a shared cache (CloudFront, proxies). The browser asks again each time
// (no max-age), so a view after a trade is never an older copy; speed comes from the server-side caches instead.
const PRIVATE = { 'Cache-Control': 'private, no-cache', Vary: 'Cookie' };
const withHeaders = (res: Response) => {
    for (const [name, value] of Object.entries(PRIVATE)) res.headers.set(name, value);
    return res;
};

// Never waits on a build: with no run for today it starts one and answers building: true.
// Every sentence is in the request's language, re-rendered from the logged run whatever language it was computed in.
export const GET = async (req: NextRequest) => withHeaders(await respond(async () => {
    const [locale, scope] = await Promise.all([requestLocale(req), requestScope(req)]);
    return getWatchlist(locale, scope);
}, req));
