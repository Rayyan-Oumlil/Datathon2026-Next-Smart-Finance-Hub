import { NextRequest } from 'next/server';
import { requestLocale, respond } from '@/lib/services/http';
import { getModelPortfolios } from '@/lib/services/model-portfolio';
import { requestScope } from '@/lib/session';

export const dynamic = 'force-dynamic';

// Per-visitor data: never stored by a shared cache (CloudFront, proxies). The browser asks again each time
// (no max-age), so a view after a trade is never an older copy; speed comes from the server-side caches instead.
const PRIVATE = { 'Cache-Control': 'private, no-cache', Vary: 'Cookie' };
const withHeaders = (res: Response) => {
    for (const [name, value] of Object.entries(PRIVATE)) res.headers.set(name, value);
    return res;
};

/**
 * The three suggested portfolios of the visitor's risk level (rules/v1.json -> model_portfolios), adjusted by the
 * table's rules, each line with its reasons, and each option's risk figures over the replay snapshot when available.
 * Teaching examples only: nothing is placed by this call.
 */
export const GET = async (req: NextRequest) => withHeaders(await respond(async () => {
    const [locale, scope] = await Promise.all([requestLocale(req), requestScope(req)]);
    return getModelPortfolios(locale, scope);
}, req));
