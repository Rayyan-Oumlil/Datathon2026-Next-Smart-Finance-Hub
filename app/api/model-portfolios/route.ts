import { NextRequest } from 'next/server';
import { requestLocale, respond } from '@/lib/services/http';
import { getModelPortfolios } from '@/lib/services/model-portfolio';
import { requestScope } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * The three suggested portfolios of the visitor's risk level (rules/v1.json -> model_portfolios), adjusted by the
 * table's rules, each line with its reasons, and each option's risk figures over the replay snapshot when available.
 * Teaching examples only: nothing is placed by this call.
 */
export const GET = (req: NextRequest) => respond(async () => {
    const [locale, scope] = await Promise.all([requestLocale(req), requestScope(req)]);
    return getModelPortfolios(locale, scope);
}, req);
