// Reset by new generation (brief rule R4). A reset erases nothing: the session moves to a new generation whose
// storage ids hold nothing yet, the decision log and the agent action log keep every row under the old ids, and the
// old app-state document stays as it was. Two steps: the first call describes what the visitor will no longer see
// and returns a short-lived signed token; only a second call with that token opens the new generation.
// The agent cannot reach this: 'reset' is not on the action whitelist (lib/agent/router.ts) and no internal tool
// route calls it.

import type { DecisionLogEntry } from '@/lib/domain/types';
import { getPortfolioState } from '@/lib/services/portfolio';
import { appendDecision, emptyState, getProfile, readSessionItem, readState, seedState, writeSessionItem, VersionConflictError, type AppState } from '@/lib/store';
import { getSessionSecret } from './config';
import { generationsOf } from './index';
import { RESET_LEVELS, nextGenerations, sameGenerations, scopeFor, type Generations, type ResetLevel, type Scope } from './scope';
import { signToken, verifyToken } from './token';

export const RESET_TOKEN_SECONDS = 120;

export type ResetSummary = {
    level: ResetLevel;
    // What the visitor will no longer see once the new generation is open (it all stays in the old generation)
    positions: number;          // simulated positions held (portfolio, all)
    trades: number;             // simulated trades (portfolio, all)
    rules: number;              // investment rules (portfolio, all)
    profile: boolean;           // whether a profile exists and will be replaced by a new onboarding (profile, all)
    layout: boolean;            // whether a saved layout goes back to the level template (profile, all)
    watchlistMarks: number;     // pinned and dismissed watchlist symbols (every level: the watchlist reads both)
    pendingChanges: number;     // agent changes waiting for an answer or still undoable (every level)
    journalsKept: true;         // the decision log and the agent action log are kept, whatever the level
    backToOnboarding: boolean;
    from: Generations;
    to: Generations;
};

type ResetTokenPayload = { sid: string; level: ResetLevel; p: number; f: number; exp: number };

export type ResetResponse =
    | { needsConfirmation: true; token: string; expiresAt: string; summary: ResetSummary; rejected?: 'invalid' | 'expired' | 'stale' }
    | { done: true; level: ResetLevel; generations: Generations; redirectTo: string | null; decisionId: string };

const live = (preview: { status?: string }) => preview.status === 'pending' || preview.status === 'applied';

export function isResetLevel(value: unknown): value is ResetLevel {
    return typeof value === 'string' && (RESET_LEVELS as readonly string[]).includes(value);
}

/** What a reset of this level would hide from the visitor, read from the current generation. Nothing is changed. */
export async function resetSummary(scope: Scope, level: ResetLevel): Promise<ResetSummary> {
    const portfolioGoes = level !== 'profile';
    const profileGoes = level !== 'portfolio';
    const [state, portfolio, profile] = await Promise.all([
        readState(scope),
        portfolioGoes ? getPortfolioState(scope) : null,
        profileGoes ? getProfile(scope.profileUserId) : null,
    ]);
    return {
        level,
        positions: portfolio?.positions.length ?? 0,
        trades: portfolio?.trades.length ?? 0,
        rules: portfolioGoes ? state.rules.length : 0,
        profile: Boolean(profile),
        layout: profileGoes && state.layout !== null,
        watchlistMarks: state.watchlist.pinned.length + state.watchlist.dismissed.length,
        pendingChanges: state.pendingPreviews.filter((p) => live(p as { status?: string })).length,
        journalsKept: true,
        backToOnboarding: profileGoes,
        from: scope.generations,
        to: nextGenerations(scope.generations, level),
    };
}

export async function issueResetToken(scope: Scope, level: ResetLevel, nowMs = Date.now()): Promise<{ token: string; expiresAt: string }> {
    const exp = Math.floor(nowMs / 1000) + RESET_TOKEN_SECONDS;
    const payload: ResetTokenPayload = { sid: scope.sessionId, level, p: scope.generations.profile, f: scope.generations.portfolio, exp };
    return { token: await signToken(payload, getSessionSecret(), 'reset'), expiresAt: new Date(exp * 1000).toISOString() };
}

/**
 * Why a confirmation token does not allow this reset, or null when it does. The token names the session, the level
 * and the generations it was issued for: once a reset has run, the same token no longer matches (single use).
 */
export async function checkResetToken(token: unknown, scope: Scope, level: ResetLevel, nowMs = Date.now()): Promise<'invalid' | 'expired' | 'stale' | null> {
    const payload = await verifyToken<ResetTokenPayload>(typeof token === 'string' ? token : null, getSessionSecret(), 'reset');
    if (!payload || payload.sid !== scope.sessionId || payload.level !== level) return 'invalid';
    if (!(payload.exp > Math.floor(nowMs / 1000))) return 'expired';
    if (!sameGenerations({ profile: payload.p, portfolio: payload.f }, scope.generations)) return 'stale';
    return null;
}

/** What the new generation's app-state document starts with: only what this level keeps. */
export function carriedState(old: AppState, level: ResetLevel): AppState {
    const fresh = emptyState();
    if (level === 'portfolio') fresh.layout = old.layout;       // the layout follows the profile
    if (level === 'profile') fresh.rules = old.rules;           // the rules follow the simulated portfolio
    return structuredClone(fresh);
}

export class StaleResetError extends Error {
    constructor() {
        super('the session changed generation since the reset was confirmed');
        this.name = 'StaleResetError';
    }
}

/**
 * Opens the next generation of the session: the record moves on (a conditional write, so two resets confirmed with
 * the same token cannot both run), the new app-state document is seeded, and one session_reset row is appended.
 * Returns the new scope and the logged row. No existing row of any log is touched.
 */
export async function performReset(scope: Scope, level: ResetLevel, summary: ResetSummary, nowMs = Date.now()): Promise<{ scope: Scope; decision: DecisionLogEntry }> {
    const at = new Date(nowMs).toISOString();
    const record = await readSessionItem(scope.sessionId);
    const current: Generations = record ? { profile: record.profileGeneration, portfolio: record.portfolioGeneration } : { profile: 0, portfolio: 0 };
    if (!sameGenerations(current, scope.generations)) throw new StaleResetError();
    const to = nextGenerations(current, level);
    try {
        await writeSessionItem({
            sessionId: scope.sessionId,
            profileGeneration: to.profile,
            portfolioGeneration: to.portfolio,
            createdAt: record?.createdAt ?? at,
            history: [...(record?.history ?? []), { at, level, from: current, to }],
        }, record?.version ?? 0);
    } catch (error) {
        if (error instanceof VersionConflictError) throw new StaleResetError();
        throw error;
    }
    const next = scopeFor(scope.sessionId, to);
    await seedState(next, carriedState(await readState(scope), level));
    const decision = await appendDecision({
        userId: scope.sessionLogId,
        kind: 'session_reset',
        at,
        payload: {
            level,
            from: current,
            to,
            fromScopeId: scope.scopeId,
            toScopeId: next.scopeId,
            hidden: summary,
            journalsKept: true,
            origin: 'user',
            simulated: true,
        },
    });
    return { scope: next, decision };
}

/**
 * POST /api/reset. Without a valid confirmation token: the summary and a new token. With one: the reset.
 * The token check also refuses a token issued before another reset ran (stale).
 */
export async function requestReset(scope: Scope, input: { level: ResetLevel; confirm?: string | null }, nowMs = Date.now()): Promise<ResetResponse> {
    const { level } = input;
    const rejected = input.confirm ? await checkResetToken(input.confirm, scope, level, nowMs) : 'missing';
    if (rejected === null) {
        const summary = await resetSummary(scope, level);
        try {
            const { scope: next, decision } = await performReset(scope, level, summary, nowMs);
            return { done: true, level, generations: next.generations, redirectTo: summary.backToOnboarding ? '/onboarding' : null, decisionId: decision.id };
        } catch (error) {
            if (!(error instanceof StaleResetError)) throw error;
            const fresh = scopeFor(scope.sessionId, await generationsOf(scope.sessionId));
            return { needsConfirmation: true, ...(await issueResetToken(fresh, level, nowMs)), summary: await resetSummary(fresh, level), rejected: 'stale' };
        }
    }
    return {
        needsConfirmation: true,
        ...(await issueResetToken(scope, level, nowMs)),
        summary: await resetSummary(scope, level),
        ...(rejected !== 'missing' ? { rejected } : {}),
    };
}

/** Every generation a session has been through, oldest first, from its record (for the logs page of a later block). */
export async function generationTrail(sessionId: string): Promise<Array<{ scope: Scope; from: string | null; to: string | null; level: ResetLevel | null }>> {
    const record = await readSessionItem(sessionId);
    const trail: Array<{ scope: Scope; from: string | null; to: string | null; level: ResetLevel | null }> = [{ scope: scopeFor(sessionId, { profile: 0, portfolio: 0 }), from: record?.createdAt ?? null, to: null, level: null }];
    for (const step of record?.history ?? []) {
        trail[trail.length - 1].to = step.at;
        trail.push({ scope: scopeFor(sessionId, step.to), from: step.at, to: null, level: step.level });
    }
    return trail;
}
