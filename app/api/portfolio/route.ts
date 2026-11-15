import type { NextRequest } from 'next/server';
import { requestLocale, respond } from '@/lib/services/http';
import { getPortfolio } from '@/lib/services/portfolio';
import { requestScope } from '@/lib/session';

export const dynamic = 'force-dynamic';

// Per-visitor data: never stored by a shared cache (CloudFront, proxies). The browser asks again each time
// (no max-age), so a view after a trade is never an older copy; speed comes from the server-side caches instead.
const PRIVATE = { 'Cache-Control': 'private, no-cache', Vary: 'Cookie' };
const withHeaders = (res: Response) => {
    for (const [name, value] of Object.entries(PRIVATE)) res.headers.set(name, value);
    return res;
};

// Notes, trade reasons and group names follow the request's language.
export const GET = async (req: NextRequest) => withHeaders(await respond(async () => {
    const [locale, scope] = await Promise.all([requestLocale(req), requestScope(req)]);
    return getPortfolio(locale, scope);
}, req));
