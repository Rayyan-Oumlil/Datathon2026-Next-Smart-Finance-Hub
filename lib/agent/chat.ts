// One agent request on the web side: chat input, context, the call to the agent service, the last wording
// check, the action router, and later confirm / cancel / undo. Every step leaves a row in the agent action log.

import { createHash, randomBytes } from 'node:crypto';
import type { Locale } from '@/i18n/config';
import { getAppLocale } from '@/i18n/locale';
import type { AgentReply, FilterCheck } from '@/lib/domain/types';
import { callAgent, type AgentProgress, type AgentServiceReply } from './client';
import { buildContext } from './context';
import { replyLanguage } from './language';
import { logStep as writeStep } from './log';
import { describePage, type PageInput } from './page';
import { ReplyCache, cacheKey, isCacheable } from './reply-cache';
import { ServiceError } from '@/lib/services/errors';
import { currentScope, type Scope } from '@/lib/session';
import { apply, cancel, getAction, route, undo, type Preview } from './router';
import { agentText } from './text';
import { failsWordCheck, quotedUserText } from './wording';
import { widgetLibrary } from '@/lib/services/layout';

export type Turn = { role: 'user' | 'assistant'; text: string };
export type ChatInput = { message: string; history?: Turn[]; conversationId?: string; page?: PageInput };
export type ChatReply = AgentReply & {
    language: Locale;               // the language the reply is in: the message's own, not necessarily the app's
    preview?: Preview;
    notice?: string;                // why a proposed action was not shown
    promptVersion?: string;
    modelCalls: AgentServiceReply['modelCalls'];
    logComplete?: boolean;          // false when the agent service could not write every row of its action log
};

// Glossary answers only (reply-cache.ts); AGENT_REPLY_CACHE=off turns it off
const replyCache = new ReplyCache<AgentServiceReply>();
export const resetReplyCache = (): void => replyCache.clear();
const cacheOn = () => process.env.AGENT_REPLY_CACHE !== 'off';

const MAX_TURNS = 10;
const MAX_TURN_CHARS = 4000;
const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
type StepArgs = Parameters<typeof writeStep> extends [unknown, ...infer Rest] ? Rest : never;

// A reply that goes with one of these proposals is a short sentence about a settings change (agent/app/main.py SETTING_TYPES)
const SETTING_TYPES = new Set(['layout_change', 'rule_create', 'rule_pause', 'strategy_propose', 'profile_change']);
const WIDGET_TITLES = [...widgetLibrary('en'), ...widgetLibrary('fr')].map((widget) => widget.title);

/**
 * The names the wording check leaves out of a reply: the watchlist picks, the app's own widget titles in both
 * languages and, for a reply about a settings change, the names the user gave (strategy name, rule wording) and short
 * quotes of the user's own message.
 */
function quotableNames(reply: AgentServiceReply, message: string, watchlist: string[]): string[] {
    const proposed = (reply.proposed ?? null) as { type?: string; params?: { strategy?: { name?: unknown }; rule?: { text?: unknown } } } | null;
    if (!proposed?.type || !SETTING_TYPES.has(proposed.type)) return [...watchlist, ...WIDGET_TITLES];
    const given = [proposed.params?.strategy?.name, proposed.params?.rule?.text].filter((value): value is string => typeof value === 'string');
    return [...watchlist, ...WIDGET_TITLES, ...given, ...quotedUserText(reply.text, [message, ...given])];
}

/** Shown in place of a reply that holds a never-word or judgement word, in the request's language. */
export const NEUTRAL_REPLY = agentText('en').neutralReply;
export const NEUTRAL_REPLY_FR = agentText('fr').neutralReply;

/**
 * One agent request. `onProgress`, when given, hears each stage of the agent service while it works. `scope` is the
 * visitor's (default: the current request's session); the agent service receives its scope id as userId, and both
 * sides log under that id.
 */
export async function chat(input: ChatInput, onProgress?: (event: AgentProgress) => void, scope?: Scope): Promise<ChatReply> {
    const s = scope ?? await currentScope();
    const logStep = (...args: StepArgs) => writeStep(s, ...args);
    const actionId = `act_${randomBytes(8).toString('hex')}`;
    const history = (input.history ?? []).slice(-MAX_TURNS).map((turn) => ({ role: turn.role, text: turn.text.slice(0, MAX_TURN_CHARS) }));
    await logStep(actionId, 'chat_input', { dataUsed: { message: input.message, messageSha256: sha256(input.message), historyTurns: history.length } });

    // The reply is in the language of the message (typed or dictated); the app's language is only the last resort
    const appLocale = await getAppLocale();
    const { locale, basis } = replyLanguage(input.message, history, appLocale);
    const built = await buildContext(locale, s);
    const { snapshotId } = built;
    // Where the user is, from a fixed list of pages: "this X-ray", "here" and "this period" refer to it
    const page = describePage(input.page);
    const context = page ? { ...built.context, page } : built.context;
    const words = agentText(locale);
    await logStep(actionId, 'context_built', {
        dataUsed: {
            locale, localeBasis: basis, appLocale, level: context.level ?? null, risk: context.risk ?? null, agentStyle: context.agentStyle ?? null,
            holdings: context.holdings, watchlist: context.watchlist, layout: context.layout, strategies: context.strategies, page: context.page ?? null, watchlistSnapshotId: snapshotId,
            contextSha256: sha256(JSON.stringify(context)),
        },
        statedReason: 'Only data the app holds: profile, simulated holdings, watchlist picks, layout, stored strategies (names and rule kinds), and which page the user is on. No sentiment data and no news text.',
    });

    // A question asked on its own, answered before in the same language and settings, needs no new model call.
    // Mid-conversation questions depend on the turns before them, so they never use the cache.
    const key = cacheOn() && history.length === 0
        ? cacheKey({ message: input.message, locale, level: context.level, risk: context.risk, agentStyle: context.agentStyle, page: context.page })
        : null;
    const cached = key ? replyCache.get(key) : undefined;

    let reply: AgentServiceReply;
    if (cached) {
        onProgress?.({ type: 'stage', stage: 'cache', state: 'done', ok: true, ms: 0 });
        reply = { ...cached.value, modelCalls: [] };          // this request made no model call
    } else {
        try {
            reply = await callAgent({ actionId, userId: s.scopeId, message: input.message, history, context, ...(input.conversationId ? { conversationId: input.conversationId } : {}) }, input.conversationId, onProgress);
        } catch (error) {
            await logStep(actionId, 'result', { result: { error: error instanceof Error ? error.message : 'agent call failed' } });
            throw error;
        }
    }

    // Last wording check, after the agent service's own: a reply with a never-word or a judgement word (English or
    // French) is not shown at all. Names of the app's own assets and of the watchlist picks may be quoted.
    const withheld = failsWordCheck(reply.text, quotableNames(reply, input.message, context.watchlist.map((pick) => pick.name)));
    const refused = reply.refused || withheld;
    const text = withheld ? words.neutralReply : reply.text;

    if (key && !cached && !withheld && isCacheable(reply)) replyCache.set(key, reply, actionId);

    const routed = await route(actionId, refused ? undefined : reply.proposed, locale, s);
    await logStep(actionId, 'action_routed', {
        dataUsed: { proposed: reply.proposed ?? null },
        result: routed.outcome === 'dropped' ? { outcome: 'dropped', type: routed.type } : { outcome: routed.outcome, type: 'proposed' in routed ? routed.proposed.type : null },
        statedReason: routed.outcome === 'dropped' ? (routed.detail ? `${routed.reason} (${routed.detail})` : routed.reason) : refused && reply.proposed ? 'The reply was refused, so its proposal was not routed.' : undefined,
    });
    if (routed.outcome === 'preview') {
        await logStep(actionId, 'preview_shown', { before: routed.preview.before, after: routed.preview.after, dataUsed: { type: routed.proposed.type, params: routed.proposed.params, facts: routed.preview.facts, conflicts: routed.conflicts }, statedReason: routed.preview.summary });
    }

    // For a simulated trade the conflicts come from the app's own check at preview time
    // (for a strategy, the symbols each conflict is about, as the strategy's own check named them)
    const conflictSymbol = (checks: FilterCheck[]) => [...new Set(checks.map((check) => (check as FilterCheck & { symbol?: string }).symbol).filter((s): s is string => Boolean(s) && s !== 'strategy'))].join(', ');
    const ownConflicts = routed.outcome === 'preview' && routed.conflicts.length > 0
        ? { symbol: (routed.proposed.type as string) === 'strategy_propose' ? conflictSymbol(routed.conflicts) || routed.preview.strategy?.name || '' : String(routed.proposed.params.symbol), checks: routed.conflicts }
        : undefined;
    const fromAgent = reply.conflict ? { symbol: reply.conflict.symbol, checks: reply.conflict.checks as FilterCheck[] } : undefined;
    const conflict = withheld ? undefined : ownConflicts ?? fromAgent;

    const out: ChatReply = {
        actionId,
        language: locale,
        text,
        sources: withheld ? [] : reply.sources.map(({ label, source, fetchedAt, asOf }) => ({ label, source, ...(fetchedAt ? { fetchedAt } : {}), ...(asOf ? { asOf } : {}) })),
        refused,
        ...('proposed' in routed ? { proposed: routed.proposed } : {}),
        ...(routed.outcome === 'preview' ? { preview: routed.preview } : {}),
        // The full reason stays in the log; a reason that quotes a never-word (a schema's own value names) is not shown
        ...(routed.outcome === 'dropped' ? { notice: words.notShown(failsWordCheck(routed.reason) ? words.paramsInvalidShort : routed.reason) } : {}),
        ...(conflict ? { conflict } : {}),
        promptVersion: reply.promptVersion,
        modelCalls: reply.modelCalls,
        ...(reply.logComplete !== undefined ? { logComplete: reply.logComplete } : {}),
    };
    await logStep(actionId, 'result', {
        promptVersion: reply.promptVersion,
        replySha256: sha256(text),
        result: {
            refused, withheldByWordCheck: withheld, sources: out.sources.length, proposed: out.proposed?.type ?? null,
            pendingConfirm: routed.outcome === 'preview', conflict: Boolean(conflict), modelCalls: reply.modelCalls.length,
            agentLogComplete: reply.logComplete ?? null,
            ...(cached ? { cache: { hit: true, fromActionId: cached.actionId } } : {}),
        },
        statedReason: withheld ? 'The reply held a word from the never-lists or judgement lists and was replaced by the fixed neutral sentence.' : undefined,
    });
    return out;
}

// The messages of confirm and undo are in the language of the conversation when the caller says which (the panel does,
// from the reply's own language), and in the app's language otherwise
export async function confirm(actionId: string, accept: boolean, language?: Locale, scope?: Scope): Promise<{ applied: boolean; undoable: boolean; result?: unknown; message: string }> {
    const s = scope ?? await currentScope();
    const logStep = (...args: StepArgs) => writeStep(s, ...args);
    const locale = language ?? await getAppLocale();
    const words = agentText(locale);
    if (!accept) {
        const action = await cancel(actionId, locale, s);
        await logStep(actionId, 'cancelled', { dataUsed: { type: action.proposed.type }, before: action.preview.before });
        return { applied: false, undoable: false, message: words.cancelled };
    }
    // A change that is not waiting for an answer is refused before anything is logged as confirmed
    const waiting = await getAction(actionId, s);
    if (!waiting) throw new ServiceError(404, words.noSuchChange);
    if (waiting.status !== 'pending') throw new ServiceError(409, words.onlyPending(waiting.status));
    await logStep(actionId, 'confirmed', { statedReason: 'The user confirmed the preview.' });
    try {
        const { before, after, ...outcome } = await apply(actionId, locale, s);
        if (outcome.applied) await logStep(actionId, 'applied', { before, after, result: outcome.result });
        await logStep(actionId, 'result', { result: { applied: outcome.applied, undoable: outcome.undoable, message: outcome.message } });
        return outcome;
    } catch (error) {
        await logStep(actionId, 'result', { result: { applied: false, error: error instanceof Error ? error.message : 'apply failed' } });
        throw error;
    }
}

export async function undoAction(actionId: string, language?: Locale, scope?: Scope): Promise<{ restored: boolean; result?: unknown; message: string }> {
    const s = scope ?? await currentScope();
    const outcome = await undo(actionId, language ?? await getAppLocale(), s);
    await writeStep(s, actionId, 'undo', { result: outcome });
    return outcome;
}
