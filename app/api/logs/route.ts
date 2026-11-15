import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requestLocale, respond } from '@/lib/services/http';
import { ServiceError } from '@/lib/services/errors';
import { renderDecision } from '@/lib/services/decision-text';
import { listAgentActions } from '@/lib/store';
import { getSession, listScopeDecisions, scopeFor } from '@/lib/session';
import { sessionGenerations } from './generations';

export const dynamic = 'force-dynamic';

const KINDS = ['watchlist_run', 'pick', 'user_action', 'simulated_trade', 'profile_conflict', 'profile_change', 'session_reset'] as const;
const schema = z.object({
    table: z.enum(['agent', 'decisions']).default('agent'),
    actionId: z.string().trim().min(1).max(60).optional(),
    kind: z.enum(KINDS).optional(),
    p: z.coerce.number().int().min(0).max(999999).optional(),
    f: z.coerce.number().int().min(0).max(999999).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(200),
});

// A watchlist run holds the whole snapshot (hundreds of kB): the bulky parts are left out and named, as /api/decisions does
const BULKY = ['snapshot', 'candidates', 'signals'];

// The raw journal of the visitor's own session for /logs, newest first: agent_action_log rows (optionally of one
// actionId) or decision_log rows (optionally of one kind), of the current generation or of an earlier one (p, f).
// Read only: no route changes a logged row.
export const GET = (req: NextRequest) => respond(async () => {
    const q = schema.parse(Object.fromEntries(req.nextUrl.searchParams));
    const { sessionId } = await getSession(req);
    const generations = await sessionGenerations(sessionId);
    const wanted = q.p === undefined || q.f === undefined
        ? generations.find((g) => g.current)!
        : generations.find((g) => g.profile === q.p && g.portfolio === q.f);
    if (!wanted) throw new ServiceError(404, 'unknown generation');
    const scope = scopeFor(sessionId, { profile: wanted.profile, portfolio: wanted.portfolio });

    if (q.table === 'agent') {
        const rows = await listAgentActions(scope.scopeId, q.actionId ? { actionId: q.actionId } : {});
        rows.sort((a, b) => (a.id < b.id ? 1 : -1));
        return { generation: wanted, rows: rows.slice(0, q.limit) };
    }
    const locale = await requestLocale(req);
    const decisions = (await listScopeDecisions(scope, { kind: q.kind, limit: q.limit, newestFirst: true })).map((row) => {
        const rendered = renderDecision(row, locale);
        const payload = rendered.payload;
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return rendered;
        const omitted = BULKY.filter((key) => key in payload);
        if (omitted.length === 0) return rendered;
        return { ...rendered, payload: Object.fromEntries(Object.entries(payload).filter(([key]) => !omitted.includes(key))), payloadOmitted: omitted };
    });
    return { generation: wanted, decisions };
}, req);
