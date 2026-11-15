// One agent request on the web side: chat input, context, the call to the agent service, the last wording
// check, the action router, and later confirm / cancel / undo. Every step leaves a row in the agent action log.

import { createHash, randomBytes } from 'node:crypto';
import { DEMO_USER } from '@/lib/demo-user';
import type { AgentReply, FilterCheck } from '@/lib/domain/types';
import { containsNeverWord } from '@/lib/watchlist/reasons';
import { callAgent, type AgentServiceReply } from './client';
import { buildContext } from './context';
import { logStep } from './log';
import { ServiceError } from '@/lib/services/errors';
import { apply, cancel, getAction, route, undo, type Preview } from './router';

export type Turn = { role: 'user' | 'assistant'; text: string };
export type ChatInput = { message: string; history?: Turn[]; conversationId?: string };
export type ChatReply = AgentReply & {
    preview?: Preview;
    notice?: string;                // why a proposed action was not shown
    promptVersion?: string;
    modelCalls: AgentServiceReply['modelCalls'];
    logComplete?: boolean;          // false when the agent service could not write every row of its action log
};

const MAX_TURNS = 10;
const MAX_TURN_CHARS = 4000;
const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** Shown in place of a reply that holds a word from the never-list of the rules file. */
export const NEUTRAL_REPLY = 'The app withheld this reply because of its wording. I can explain a term from the glossary, show data with its source, or explain why an asset is on your list. This app is a simulation and does not give investment advice.';

export async function chat(input: ChatInput): Promise<ChatReply> {
    const actionId = `act_${randomBytes(8).toString('hex')}`;
    const history = (input.history ?? []).slice(-MAX_TURNS).map((turn) => ({ role: turn.role, text: turn.text.slice(0, MAX_TURN_CHARS) }));
    await logStep(actionId, 'chat_input', { dataUsed: { message: input.message, messageSha256: sha256(input.message), historyTurns: history.length } });

    const { context, snapshotId } = await buildContext();
    await logStep(actionId, 'context_built', {
        dataUsed: {
            level: context.level ?? null, risk: context.risk ?? null, agentStyle: context.agentStyle ?? null,
            holdings: context.holdings, watchlist: context.watchlist, layout: context.layout, watchlistSnapshotId: snapshotId,
            contextSha256: sha256(JSON.stringify(context)),
        },
        statedReason: 'Only data the app holds: profile, simulated holdings, watchlist picks, layout. No sentiment data and no news text.',
    });

    let reply: AgentServiceReply;
    try {
        reply = await callAgent({ actionId, userId: DEMO_USER.id, message: input.message, history, context }, input.conversationId);
    } catch (error) {
        await logStep(actionId, 'result', { result: { error: error instanceof Error ? error.message : 'agent call failed' } });
        throw error;
    }

    // Last wording check, after the agent service's own: a reply with a never-word is not shown at all
    const withheld = containsNeverWord(reply.text);
    const refused = reply.refused || withheld;
    const text = withheld ? NEUTRAL_REPLY : reply.text;

    const routed = await route(actionId, refused ? undefined : reply.proposed);
    await logStep(actionId, 'action_routed', {
        dataUsed: { proposed: reply.proposed ?? null },
        result: routed.outcome === 'dropped' ? { outcome: 'dropped', type: routed.type } : { outcome: routed.outcome, type: 'proposed' in routed ? routed.proposed.type : null },
        statedReason: routed.outcome === 'dropped' ? routed.reason : refused && reply.proposed ? 'The reply was refused, so its proposal was not routed.' : undefined,
    });
    if (routed.outcome === 'preview') {
        await logStep(actionId, 'preview_shown', { before: routed.preview.before, after: routed.preview.after, dataUsed: { type: routed.proposed.type, params: routed.proposed.params, facts: routed.preview.facts, conflicts: routed.conflicts }, statedReason: routed.preview.summary });
    }

    // For a simulated trade the conflicts come from the app's own check at preview time
    const ownConflicts = routed.outcome === 'preview' && routed.conflicts.length > 0 ? { symbol: String(routed.proposed.params.symbol), checks: routed.conflicts } : undefined;
    const fromAgent = reply.conflict ? { symbol: reply.conflict.symbol, checks: reply.conflict.checks as FilterCheck[] } : undefined;
    const conflict = withheld ? undefined : ownConflicts ?? fromAgent;

    const out: ChatReply = {
        actionId,
        text,
        sources: withheld ? [] : reply.sources.map(({ label, source, fetchedAt, asOf }) => ({ label, source, ...(fetchedAt ? { fetchedAt } : {}), ...(asOf ? { asOf } : {}) })),
        refused,
        ...('proposed' in routed ? { proposed: routed.proposed } : {}),
        ...(routed.outcome === 'preview' ? { preview: routed.preview } : {}),
        // The full reason stays in the log; a reason that quotes a never-word (a schema's own value names) is not shown
        ...(routed.outcome === 'dropped' ? { notice: `A proposed change was not shown: ${containsNeverWord(routed.reason) ? 'its parameters are not valid.' : routed.reason}` } : {}),
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
        },
        statedReason: withheld ? 'The reply held a word from the never-list and was replaced by the fixed neutral sentence.' : undefined,
    });
    return out;
}

export async function confirm(actionId: string, accept: boolean): Promise<{ applied: boolean; undoable: boolean; result?: unknown; message: string }> {
    if (!accept) {
        const action = await cancel(actionId);
        await logStep(actionId, 'cancelled', { dataUsed: { type: action.proposed.type }, before: action.preview.before });
        return { applied: false, undoable: false, message: 'Cancelled. Nothing was changed.' };
    }
    // A change that is not waiting for an answer is refused before anything is logged as confirmed
    const waiting = await getAction(actionId);
    if (!waiting) throw new ServiceError(404, 'No proposed change has this id.');
    if (waiting.status !== 'pending') throw new ServiceError(409, `This change is ${waiting.status}; only a pending change can be applied.`);
    await logStep(actionId, 'confirmed', { statedReason: 'The user confirmed the preview.' });
    try {
        const { before, after, ...outcome } = await apply(actionId);
        if (outcome.applied) await logStep(actionId, 'applied', { before, after, result: outcome.result });
        await logStep(actionId, 'result', { result: { applied: outcome.applied, undoable: outcome.undoable, message: outcome.message } });
        return outcome;
    } catch (error) {
        await logStep(actionId, 'result', { result: { applied: false, error: error instanceof Error ? error.message : 'apply failed' } });
        throw error;
    }
}

export async function undoAction(actionId: string): Promise<{ restored: boolean; result?: unknown; message: string }> {
    const outcome = await undo(actionId);
    await logStep(actionId, 'undo', { result: outcome });
    return outcome;
}
