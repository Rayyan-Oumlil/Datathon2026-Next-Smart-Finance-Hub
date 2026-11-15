import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requestLocale, respond } from '@/lib/services/http';
import { renderDecision } from '@/lib/services/decision-text';
import { listScopeDecisions, requestScope } from '@/lib/session';

export const dynamic = 'force-dynamic';

const KINDS = ['watchlist_run', 'pick', 'user_action', 'simulated_trade', 'profile_conflict', 'profile_change', 'session_reset'] as const;
const schema = z.object({
    kind: z.enum(KINDS).optional(),
    symbol: z.string().trim().min(1).max(20).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    full: z.string().optional(),
});

// A watchlist run holds the whole snapshot (hundreds of kB). Unless full=1, the bulky parts are left out and named.
const BULKY = ['snapshot', 'candidates', 'signals'];

// The sentences of each row (filter checks, factor details, reasons, trade reasons) are shown in the request's
// language, re-rendered from the values logged beside them; the stored rows themselves are never changed.
// Only the visitor's current generation is listed (lib/session listScopeDecisions); earlier generations stay logged.
export const GET = (req: NextRequest) => respond(async () => {
    const { kind, symbol, limit, full } = schema.parse(Object.fromEntries(req.nextUrl.searchParams));
    const locale = await requestLocale(req);
    const scope = await requestScope(req);
    const decisions = (await listScopeDecisions(scope, { kind, symbol: symbol?.toUpperCase(), limit, newestFirst: true })).map((row) => renderDecision(row, locale));
    if (full === '1') return { decisions };
    return {
        decisions: decisions.map((decision) => {
            const payload = decision.payload;
            if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return decision;
            const omitted = BULKY.filter((key) => key in payload);
            if (omitted.length === 0) return decision;
            const kept = Object.fromEntries(Object.entries(payload).filter(([key]) => !omitted.includes(key)));
            return { ...decision, payload: kept, payloadOmitted: omitted };
        }),
    };
}, req);
