// The anonymous visitor session on the server: which session a request belongs to, and which storage ids
// (scope, ./scope.ts) its current generation uses. The cookie itself is created by middleware.ts on the first
// visit; getSession creates it too where Next.js lets code write cookies (route handlers, server actions).

import { cookies, headers } from 'next/headers';
import type { DecisionLogEntry } from '@/lib/domain/types';
import { listDecisions, readSessionItem, type DecisionQuery } from '@/lib/store';
import { demoUserOverride, getSessionSecret } from './config';
import { ZERO_GENERATIONS, parseScopeId, sameGenerations, scopeFor, type Generations, type Scope } from './scope';
import { SESSION_COOKIE, isHttps, isSessionId, newSessionPayload, sessionCookieOptions, signSession, verifySession } from './token';

export * from './scope';
export { SessionConfigError, demoUserOverride, getSessionSecret } from './config';
export { SESSION_COOKIE, isSessionId, personaSessionId } from './token';

/** Anything a route handler gets that carries the request's cookies and headers (NextRequest, Request). */
export type RequestLike = { headers: Headers; url?: string; cookies?: { get(name: string): { value: string } | undefined } };

export type Session = {
    sessionId: string;
    // 'cookie': a valid cookie came with the request; 'new': none did (or it was tampered with or expired), so a
    // fresh session was started; 'override': DEMO_USER_ID is set and no valid cookie came with the request
    source: 'cookie' | 'new' | 'override';
};

export class NoSessionError extends Error {
    constructor() {
        super('no visitor session: called outside a request, with no scope given and DEMO_USER_ID unset');
        this.name = 'NoSessionError';
    }
}

function cookieFrom(req: RequestLike): string | undefined {
    const fromJar = req.cookies?.get(SESSION_COOKIE)?.value;
    if (fromJar !== undefined) return fromJar;
    const pair = (req.headers.get('cookie') ?? '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`));
    return pair ? decodeURIComponent(pair.slice(SESSION_COOKIE.length + 1)) : undefined;
}

type Jar = Awaited<ReturnType<typeof cookies>>;

/**
 * The visitor session of a request: from `req` when given (route handlers), else from next/headers (server components,
 * server actions). A missing, tampered or expired cookie gives a fresh session; its cookie is written when the
 * context allows it (route handler, server action), and otherwise by the middleware on the same request.
 */
export async function getSession(req?: RequestLike): Promise<Session> {
    // DEMO_USER_ID is the fallback user for a browser without a valid cookie (local use): a cookie set by a hidden
    // profile address (/u/new, /u/amira...) still wins over it
    const override = demoUserOverride();
    const now = Date.now();

    let token: string | undefined;
    let jar: Jar | null = null;
    let secure = false;
    if (req) {
        token = cookieFrom(req);
        secure = isHttps(req.headers, req.url);
    } else {
        try {
            jar = await cookies();
            token = jar.get(SESSION_COOKIE)?.value;
            secure = isHttps(await headers());
        } catch {
            if (override) return { sessionId: override, source: 'override' };
            throw new NoSessionError();
        }
    }

    if (!token && override) return { sessionId: override, source: 'override' };
    const secret = getSessionSecret();
    const payload = await verifySession(token, secret, now);
    if (payload) return { sessionId: payload.sid, source: 'cookie' };
    if (override) return { sessionId: override, source: 'override' };

    const fresh = newSessionPayload(now);
    const signed = await signSession(fresh, secret);
    try {
        (jar ?? await cookies()).set(SESSION_COOKIE, signed, sessionCookieOptions(secure));
    } catch {
        // A server component cannot write cookies; outside a request there is no response to write to
    }
    return { sessionId: fresh.sid, source: 'new' };
}

/** A signed cookie value for this session id (the hidden profile addresses switch the browser with it). */
export async function sessionCookieFor(sessionId: string, secure: boolean): Promise<{ name: string; value: string; options: ReturnType<typeof sessionCookieOptions> }> {
    const value = await signSession(newSessionPayload(Date.now(), sessionId), getSessionSecret());
    return { name: SESSION_COOKIE, value, options: sessionCookieOptions(secure) };
}

/** The current generations of a session; a session never reset has no stored record and is at 0 / 0. */
export async function generationsOf(sessionId: string): Promise<Generations> {
    const record = await readSessionItem(sessionId);
    return record ? { profile: record.profileGeneration, portfolio: record.portfolioGeneration } : { ...ZERO_GENERATIONS };
}

export async function scopeOfSession(sessionId: string): Promise<Scope> {
    return scopeFor(sessionId, await generationsOf(sessionId));
}

/** The scope of a request's session (see getSession for where the session comes from). */
export async function requestScope(req?: RequestLike): Promise<Scope> {
    return scopeOfSession((await getSession(req)).sessionId);
}

/**
 * The scope of the request being served. Services take an optional scope as their last parameter and fall back on
 * this one: a page or route that does not pass a scope reads its own visitor's data. Outside a request it works only
 * with DEMO_USER_ID set (scripts and tests).
 */
export const currentScope = (): Promise<Scope> => requestScope();

/**
 * The scope behind a userId the agent service sends to an internal tool route. Only the current generation of an
 * existing session id (or the DEMO_USER_ID one) is accepted: an old generation or a malformed id gives null. Session ids are random UUIDs, so a caller holding the internal token cannot enumerate them either.
 */
export async function scopeForAgentUserId(userId: unknown): Promise<Scope | null> {
    const parsed = parseScopeId(userId);
    if (!parsed) return null;
    const override = demoUserOverride();
    if (parsed.sessionId !== override && !isSessionId(parsed.sessionId)) return null;
    const scope = await scopeOfSession(parsed.sessionId);
    return sameGenerations(scope.generations, parsed.generations) ? scope : null;
}

/**
 * Every decision row of the current generation, oldest first: the profile, the simulated portfolio, what depends on
 * both, and the session's own events (resets). Row ids start with their time, so the merge keeps the time order.
 */
export async function listScopeDecisions(scope: Scope, query: DecisionQuery = {}): Promise<DecisionLogEntry[]> {
    const { limit, newestFirst, ...filter } = query;
    const ids = [scope.profileUserId, scope.portfolioUserId, scope.scopeId, scope.sessionLogId];
    const parts = await Promise.all(ids.map((userId) => listDecisions(userId, filter)));
    const rows = parts.flat().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (newestFirst) rows.reverse();
    return limit === undefined ? rows : rows.slice(0, limit);
}
