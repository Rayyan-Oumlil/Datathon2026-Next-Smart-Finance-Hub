import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requestLocale, respond } from '@/lib/services/http';
import { getStrategySuggestions } from '@/lib/services/strategy-suggestions';
import { requestScope } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * Suggested strategies and suggested rule thresholds for the visitor's risk level (rules/v1.json ->
 * strategy_suggestions), targets filled from the simulated portfolio. Teaching examples only: nothing is saved here;
 * adopting one goes through POST /api/strategy. Optional ?portfolio=<suggested portfolio id> takes the targets from
 * that suggested portfolio instead.
 */
export const GET = (req: NextRequest) => respond(async () => {
    const portfolio = z.string().trim().min(1).max(60).optional().parse(req.nextUrl.searchParams.get('portfolio') ?? undefined);
    const [locale, scope] = await Promise.all([requestLocale(req), requestScope(req)]);
    return getStrategySuggestions(locale, { portfolioOptionId: portfolio }, scope);
}, req);
