// Step 6 to 9 of an agent request: the action router. The agent service only proposes; this file decides what
// may run. A proposal whose type is not on the whitelist, or whose params do not pass their schema, is dropped.
// A change is first turned into a preview built from the app's own data, and runs only after the user confirms.

import { z } from 'zod';
import { describeAnswers } from '@/components/onboarding/labels';
import { DEMO_USER } from '@/lib/demo-user';
import type { AgentActionType, FilterCheck, InvestmentRule, OnboardingAnswers, ProposedAction, Sourced } from '@/lib/domain/types';
import { RULES } from '@/lib/rules';
import { ServiceError, round2 } from '@/lib/services/errors';
import { WIDGET_LIBRARY, getLayout, putLayout, validateLayout } from '@/lib/services/layout';
import { getPortfolioState, simulateTrade } from '@/lib/services/portfolio';
import { editProfile, getProfile, previewProfileEdit } from '@/lib/services/profile';
import { fxUsdCad, isTradable, liveQuote, signalsFor, toCad } from '@/lib/services/quotes';
import { createRule, listRules, ruleInputSchema, setRuleStatus, validateRule } from '@/lib/services/rules-engine';
import { appendDecision, readState, updateState, type PendingPreview } from '@/lib/store';
import { getEntry } from '@/lib/universe';
import { checkProfileConflict } from '@/lib/watchlist/conflict';
import { profileChangesSchema, toProfilePatch, type ProfileChanges } from './profile-changes';

// ---------------------------------------------------------------- whitelist

const symbol = z.string().trim().min(1).max(20);
const tradeParams = z.object({ symbol, side: z.enum(['buy', 'sell']), amountCad: z.number().positive().optional(), quantity: z.number().positive().optional() }).strict()
    .refine((trade) => (trade.amountCad === undefined) !== (trade.quantity === undefined), 'give either amountCad or quantity');

/** The whitelist: every action type the app accepts, the schema of its params, and whether it changes anything. */
export const ACTIONS = {
    reply: { confirm: false, params: z.object({}).passthrough() },
    lookup: { confirm: false, params: z.object({ symbols: z.array(symbol).min(1).max(10) }).strict() },
    explain_pick: { confirm: false, params: z.object({ symbol }).strict() },
    layout_change: { confirm: true, params: z.object({ layout: z.array(z.string().max(40)).max(40) }).strict() },
    rule_create: { confirm: true, params: z.object({ rule: ruleInputSchema }).strict() },
    rule_pause: { confirm: true, params: z.object({ ruleId: z.string().min(1).max(40), status: z.enum(['paused', 'active']) }).strict() },
    profile_change: { confirm: true, params: z.object({ changes: profileChangesSchema }).strict() },
    simulated_trade: { confirm: true, params: tradeParams },
} satisfies Record<AgentActionType, { confirm: boolean; params: z.ZodTypeAny }>;

const envelope = z.object({ type: z.string(), summary: z.string().max(600).default(''), params: z.record(z.string(), z.unknown()).default({}) });

// ---------------------------------------------------------------- shapes

export type PreviewRow = { label: string; before: string; after: string };
export type PreviewFact = { label: string; value: string; source?: string; fetchedAt?: string; asOf?: string };
export type Preview = { before: unknown; after: unknown; summary: string; rows: PreviewRow[]; facts: PreviewFact[] };

export type Routed =
    | { outcome: 'none' }
    | { outcome: 'dropped'; type: string; reason: string }
    | { outcome: 'info'; proposed: ProposedAction }
    | { outcome: 'preview'; proposed: ProposedAction; preview: Preview; conflicts: FilterCheck[] };

type Undo =
    | { type: 'layout_change'; layout: string[]; saved: boolean }
    | { type: 'rule_create'; ruleId: string }
    | { type: 'rule_pause'; ruleId: string; status: InvestmentRule['status'] }
    | { type: 'profile_change'; patch: { level: ProfileChanges['level']; risk: ProfileChanges['risk']; answers: OnboardingAnswers } }
    | { type: 'simulated_trade'; tradeId: string; symbol: string; side: 'buy' | 'sell'; quantity: number };

type Status = 'pending' | 'applying' | 'applied' | 'undoing' | 'undone' | 'cancelled';
/** What the app-state file keeps per proposed change: the stored type's fields plus the preview and how to undo. */
export type StoredAction = PendingPreview & { status: Status; preview: Preview; conflicts: FilterCheck[]; undo?: Undo };

export type ApplyResult = { applied: boolean; undoable: boolean; result?: unknown; message: string; before?: unknown; after?: unknown };
export type UndoResult = { restored: boolean; result?: unknown; message: string };

const KEPT_ACTIONS = 100;
const money = (value: number) => value.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const listed = (values: readonly string[]) => (values.length > 0 ? values.join(', ') : 'none');
const priceFact = (label: string, price: Sourced): PreviewFact => ({
    label, value: `${money(price.value)} ${price.currency ?? ''}`.trim(), source: price.source, fetchedAt: price.fetchedAt, asOf: price.asOf,
});

// ---------------------------------------------------------------- previews

async function layoutPreview(after: string[]): Promise<Preview> {
    const errors = validateLayout(after);
    if (errors.length > 0) throw new ServiceError(400, errors.join(' '));
    const { layout: before } = await getLayout();
    if (before.join('|') === after.join('|')) throw new ServiceError(400, 'The proposed layout is the same as the current one.');
    const title = (id: string) => WIDGET_LIBRARY.find((widget) => widget.id === id)?.title ?? id;
    const onTab = (ids: string[], tab: string) => listed(ids.filter((id) => WIDGET_LIBRARY.find((widget) => widget.id === id)?.tab === tab).map(title));
    // Only the Portfolio tab is drawn from the layout; the Overview tab is fixed.
    const removed = before.filter((id) => !after.includes(id)).map(title);
    const added = after.filter((id) => !before.includes(id)).map(title);
    const parts = [removed.length > 0 ? `removes ${removed.join(', ')}` : '', added.length > 0 ? `adds ${added.join(', ')}` : ''].filter(Boolean);
    return {
        before, after,
        summary: `Dashboard layout: ${parts.length > 0 ? parts.join('; ') : 'changes the order of the widgets'}.`,
        rows: [
            { label: 'Portfolio tab', before: onTab(before, 'portfolio'), after: onTab(after, 'portfolio') },
        ],
        facts: [],
    };
}

/** The rule in one fixed sentence, written from its fields. Price triggers are in the asset's quote currency. */
export function ruleSentence(rule: Pick<InvestmentRule, 'symbol' | 'trigger' | 'action' | 'once'>, currency = ''): string {
    const { type, value } = rule.trigger;
    const relation = type.endsWith('below') ? 'below' : 'above';
    const trigger = type.startsWith('price')
        ? `the price of ${rule.symbol} is ${relation} ${money(value)} ${currency}`.trim()
        : `the change today of ${rule.symbol} is ${relation} ${value.toFixed(2)}%`;
    const size = rule.action.amountCad !== undefined ? `${money(rule.action.amountCad)} CAD` : `${rule.action.quantity} units`;
    const action = rule.action.side === 'buy' ? `simulate a purchase of ${size} of ${rule.symbol}` : `reduce the simulated position in ${rule.symbol} by ${size}`;
    return `When ${trigger}, ${action}, ${rule.once ? 'one time only' : 'at most once per market day'}.`;
}

async function rulePreview(input: z.infer<typeof ruleInputSchema>): Promise<Preview> {
    const checked = await validateRule(input);
    if (!checked.ok) throw new ServiceError(400, `The rule cannot be created: ${checked.errors.join(' ')}`);
    const sentence = ruleSentence(checked.rule, checked.currentPrice?.currency);
    const { symbol: ruleSymbol, trigger, action, once, text } = checked.rule;
    return {
        before: null,
        after: { rule: { text, symbol: ruleSymbol, trigger, action, once }, sentence },
        summary: `New simulated rule on ${ruleSymbol}. It runs in the simulation only.`,
        rows: [{ label: 'Rule', before: 'no rule', after: sentence }, { label: 'Your wording', before: '', after: text }],
        facts: checked.currentPrice ? [priceFact(`${ruleSymbol} last price`, checked.currentPrice)] : [],
    };
}

async function rulePausePreview(ruleId: string, status: InvestmentRule['status']): Promise<Preview> {
    const rule = (await listRules()).find((r) => r.id === ruleId);
    if (!rule) throw new ServiceError(404, `No rule has the id ${ruleId}.`);
    if (rule.status === status) throw new ServiceError(400, `The rule is already ${status}.`);
    return {
        before: { ruleId, status: rule.status },
        after: { ruleId, status },
        summary: `${status === 'paused' ? 'Pauses' : 'Resumes'} the simulated rule on ${rule.symbol}.`,
        rows: [{ label: 'Status', before: rule.status, after: status }, { label: 'Rule', before: ruleSentence(rule), after: ruleSentence(rule) }],
        facts: [],
    };
}

async function profilePreview(changes: ProfileChanges): Promise<Preview> {
    const existing = await getProfile();
    const patch = toProfilePatch(changes);
    const edit = await previewProfileEdit(patch);    // refuses when no profile exists
    const fields = Object.keys(patch.answers ?? {}) as Array<keyof OnboardingAnswers>;
    const changed = fields.filter((field) => JSON.stringify(existing!.answers[field]) !== JSON.stringify(edit.profile.answers[field]));
    if (changed.length === 0 && edit.before.level === edit.after.level && edit.before.risk === edit.after.risk) {
        throw new ServiceError(400, 'The proposed profile change is the same as the current profile.');
    }
    const pick = (answers: OnboardingAnswers) => Object.fromEntries(changed.map((field) => [field, answers[field]]));
    // Shown with the onboarding's own question and answer wording, never the stored field names and values
    const worded = (answers: OnboardingAnswers) => new Map(describeAnswers(answers).map(({ question, answer }) => [question, answer]));
    const was = worded(existing!.answers);
    const now = worded(edit.profile.answers);
    const answerRows = [...new Set([...was.keys(), ...now.keys()])].filter((question) => was.get(question) !== now.get(question))
        .map((question) => ({ label: question, before: was.get(question) ?? 'not asked', after: now.get(question) ?? 'not asked' }));
    const named = [...answerRows.map((row) => row.label), ...(patch.level !== undefined ? ['Level'] : []), ...(patch.risk !== undefined ? ['Risk'] : [])];
    const { levelResult, riskResult } = edit.profile;
    return {
        before: { ...edit.before, answers: pick(existing!.answers) },
        after: { ...edit.after, answers: pick(edit.profile.answers) },
        summary: `Profile change: ${named.length > 0 ? named.join(', ') : 'answers'}. The Level and Risk rules were re-run.`,
        rows: [
            { label: 'Level', before: edit.before.level, after: edit.after.level },
            { label: 'Risk', before: edit.before.risk, after: edit.after.risk },
            ...answerRows,
        ],
        facts: [
            { label: `Level rule (${levelResult.ruleVersion})`, value: `${levelResult.level}, ${levelResult.points} points${edit.profile.levelOverridden ? '; set by hand' : ''}`, source: 'derived' },
            { label: `Risk rule (${riskResult.ruleVersion})`, value: `${riskResult.risk}, ${riskResult.points} points${edit.profile.riskOverridden ? '; set by hand' : ''}`, source: 'derived' },
        ],
    };
}

async function tradePreview(params: z.infer<typeof tradeParams>): Promise<{ preview: Preview; conflicts: FilterCheck[]; symbol: string }> {
    const entry = getEntry(params.symbol);
    if (!entry) throw new ServiceError(404, `${params.symbol} is not in the app's list of assets, so it cannot be simulated.`);
    if (!isTradable(entry)) throw new ServiceError(400, `${entry.name} is a reference value here and cannot be traded in the simulation.`);
    const profile = await getProfile();
    if (!profile) throw new ServiceError(409, 'No profile exists yet. Complete onboarding first.');
    const quote = await liveQuote(entry).catch(() => null);
    if (!quote) throw new ServiceError(502, `No price with a source is available for ${entry.symbol} right now, so nothing can be previewed.`);
    const fx = quote.price.currency === 'CAD' ? undefined : await fxUsdCad().catch(() => undefined);
    const unitCad = toCad(quote.price.value, quote.price.currency, fx);
    if (unitCad === null) throw new ServiceError(502, `The price of ${entry.symbol} cannot be converted to CAD right now.`);

    const quantity = params.quantity ?? params.amountCad! / unitCad;
    const valueCad = round2(quantity * unitCad);
    const portfolio = await getPortfolioState();
    const held = portfolio.positions.find((position) => position.symbol === entry.symbol)?.quantity ?? 0;
    const purchase = params.side === 'buy';
    if (purchase && valueCad > portfolio.cashCad) throw new ServiceError(400, `Simulated cash is ${money(portfolio.cashCad)} CAD; this purchase needs ${money(valueCad)} CAD.`);
    if (!purchase && quantity > held + 1e-6) throw new ServiceError(400, `The simulated position in ${entry.symbol} is ${held} units; ${quantity.toFixed(6)} cannot be removed.`);

    let conflicts: FilterCheck[] = [];
    if (purchase) {
        const { signals, fxUsdCad: signalFx } = await signalsFor(entry);
        conflicts = checkProfileConflict(signals, profile, RULES, signalFx ?? fx).conflicts;
    }
    const sign = purchase ? 1 : -1;
    const cashAfter = round2(portfolio.cashCad - sign * valueCad);
    const heldAfter = Math.max(0, held + sign * quantity);
    const units = (value: number) => `${Number(value.toFixed(6))} units`;
    return {
        symbol: entry.symbol,
        conflicts,
        preview: {
            before: { cashCad: portfolio.cashCad, quantity: held },
            after: { cashCad: cashAfter, quantity: Number(heldAfter.toFixed(6)), estimate: true },
            summary: purchase
                ? `Simulated purchase of about ${money(valueCad)} CAD of ${entry.symbol} (${entry.name}). No real order exists.`
                : `Simulated reduction of the ${entry.symbol} position (${entry.name}) by about ${money(valueCad)} CAD. No real order exists.`,
            rows: [
                { label: 'Simulated cash', before: `${money(portfolio.cashCad)} CAD`, after: `about ${money(cashAfter)} CAD` },
                { label: `${entry.symbol} position`, before: units(held), after: `about ${units(heldAfter)}` },
            ],
            facts: [
                priceFact(`${entry.symbol} last price`, quote.price),
                ...(fx && quote.price.currency !== 'CAD' ? [{ label: 'USD/CAD rate', value: String(fx.value), source: fx.source, fetchedAt: fx.fetchedAt, asOf: fx.asOf }] : []),
                { label: 'Fill', value: 'at the last price at the moment you confirm, so the figures above are estimates', source: 'derived' },
            ],
        },
    };
}

// ---------------------------------------------------------------- route (step 6 and 7)

const stored = async (actionId: string) => (await readState()).pendingPreviews.find((p) => p.actionId === actionId) as StoredAction | undefined;

/** Atomically moves an action from one status to another; refuses when it is in any other status. */
async function claim(actionId: string, from: Status, to: Status): Promise<StoredAction> {
    let found: StoredAction | undefined;
    let was: Status | undefined;
    await updateState((state) => {
        found = state.pendingPreviews.find((p) => p.actionId === actionId) as StoredAction | undefined;
        was = found?.status;
        if (found && was === from) found.status = to;
    });
    if (!found) throw new ServiceError(404, 'No proposed change has this id.');
    if (was !== from) throw new ServiceError(409, `This change is ${was}; only ${from === 'applied' ? 'an' : 'a'} ${from} change can be ${to === 'applying' ? 'applied' : to === 'undoing' ? 'undone' : to}.`);
    return found;
}

const settle = (actionId: string, change: (action: StoredAction) => void) => updateState((state) => {
    const found = state.pendingPreviews.find((p) => p.actionId === actionId) as StoredAction | undefined;
    if (found) change(found);
});

/** Checks a proposal against the whitelist. A change gets its preview stored; nothing is applied here. */
export async function route(actionId: string, proposal: unknown): Promise<Routed> {
    if (proposal === undefined || proposal === null) return { outcome: 'none' };
    const outer = envelope.safeParse(proposal);
    if (!outer.success) return { outcome: 'dropped', type: 'unknown', reason: 'The proposal was not in a form the app accepts.' };
    const { type, summary } = outer.data;
    if (!Object.hasOwn(ACTIONS, type)) return { outcome: 'dropped', type, reason: `"${type}" is not an action the app allows.` };
    const kind = type as AgentActionType;
    // A model writes null for a field it leaves out
    const given = Object.fromEntries(Object.entries(outer.data.params).filter(([, value]) => value !== null));
    const parsed = ACTIONS[kind].params.safeParse(given);
    if (!parsed.success) {
        const detail = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'params'}: ${issue.message}`).join('; ');
        return { outcome: 'dropped', type, reason: `The parameters of the proposed ${type.replace('_', ' ')} are not valid (${detail}).` };
    }
    const params = parsed.data as Record<string, unknown>;
    if (!ACTIONS[kind].confirm) return { outcome: 'info', proposed: { type: kind, summary, params, needsConfirm: false } };

    let preview: Preview;
    let conflicts: FilterCheck[] = [];
    try {
        if (kind === 'layout_change') preview = await layoutPreview(params.layout as string[]);
        else if (kind === 'rule_create') preview = await rulePreview(params.rule as z.infer<typeof ruleInputSchema>);
        else if (kind === 'rule_pause') preview = await rulePausePreview(params.ruleId as string, params.status as InvestmentRule['status']);
        else if (kind === 'profile_change') preview = await profilePreview(params.changes as ProfileChanges);
        else {
            const trade = await tradePreview(params as z.infer<typeof tradeParams>);
            ({ preview, conflicts } = trade);
            params.symbol = trade.symbol;
        }
    } catch (error) {
        if (error instanceof ServiceError) return { outcome: 'dropped', type, reason: error.message };
        throw error;
    }
    // The preview's sentence is written here from the app's data; the model's own summary is not shown
    const proposed: ProposedAction = { type: kind, summary: preview.summary, before: preview.before, after: preview.after, params, needsConfirm: true };
    const record: StoredAction = { actionId, createdAt: new Date().toISOString(), proposed, status: 'pending', preview, conflicts };
    await updateState((state) => {
        state.pendingPreviews = [...state.pendingPreviews.filter((p) => p.actionId !== actionId), record].slice(-KEPT_ACTIONS);
    });
    return { outcome: 'preview', proposed, preview, conflicts };
}

export const getAction = stored;

export async function cancel(actionId: string): Promise<StoredAction> {
    const action = await claim(actionId, 'pending', 'cancelled');
    return { ...action, status: 'cancelled' };
}

// ---------------------------------------------------------------- apply (step 8)

async function perform(actionId: string, action: StoredAction): Promise<ApplyResult & { undo?: Undo }> {
    const { type, params } = action.proposed;
    if (type === 'layout_change') {
        const current = await getLayout();
        const { layout } = await putLayout(params.layout);
        return { applied: true, undoable: true, result: { layout }, before: current.layout, after: layout, message: 'The dashboard layout was changed.', undo: { type, layout: current.layout, saved: current.saved } };
    }
    if (type === 'rule_create') {
        const rule = await createRule(params.rule);
        return { applied: true, undoable: true, result: { rule }, before: null, after: rule, message: `The simulated rule on ${rule.symbol} is active (${rule.id}).`, undo: { type, ruleId: rule.id } };
    }
    if (type === 'rule_pause') {
        const before = (await listRules()).find((r) => r.id === params.ruleId);
        if (!before) throw new ServiceError(404, `No rule has the id ${String(params.ruleId)}.`);
        const rule = await setRuleStatus(before.id, params.status as InvestmentRule['status']);
        return { applied: true, undoable: true, result: { rule }, before: { status: before.status }, after: { status: rule.status }, message: `The simulated rule on ${rule.symbol} is now ${rule.status}.`, undo: { type, ruleId: rule.id, status: before.status } };
    }
    if (type === 'profile_change') {
        const existing = await getProfile();
        if (!existing) throw new ServiceError(404, 'No profile exists yet. Complete onboarding first.');
        const edit = await editProfile(toProfilePatch(params.changes as ProfileChanges));
        return {
            applied: true, undoable: true, result: { before: edit.before, after: edit.after }, before: action.preview.before, after: action.preview.after,
            message: `The profile was changed: level ${edit.after.level}, risk ${edit.after.risk}.`,
            undo: { type, patch: { answers: existing.answers, level: existing.levelOverridden ? existing.level : null, risk: existing.riskOverridden ? existing.risk : null } },
        };
    }
    if (type === 'simulated_trade') {
        const trade = params as z.infer<typeof tradeParams>;
        const purchase = trade.side === 'buy';
        // The user confirmed a preview that named these conflicts; a conflict the preview did not show stops here
        const outcome = await simulateTrade({
            ...trade, origin: 'agent', acknowledgeConflict: action.conflicts.length > 0,
            reason: `${purchase ? 'simulated purchase' : 'simulated position reduction'} from the agent (action ${actionId})`,
        });
        if (outcome.status === 'conflict') return { applied: false, undoable: false, result: { conflicts: outcome.conflicts }, message: outcome.message };
        const { id, symbol: traded, quantity, price, valueCad, side } = outcome.trade;
        return {
            applied: true, undoable: true, result: { trade: outcome.trade, cashCad: outcome.portfolio.cashCad, conflicts: outcome.conflicts },
            before: action.preview.before, after: { cashCad: outcome.portfolio.cashCad, tradeId: id },
            message: `Simulated: ${quantity} units of ${traded} at ${money(price.value)} ${price.currency ?? ''} (${price.source}), ${money(valueCad)} CAD. Simulated cash is now ${money(outcome.portfolio.cashCad)} CAD.`,
            undo: { type, tradeId: id, symbol: traded, side, quantity },
        };
    }
    throw new ServiceError(400, 'This kind of action has nothing to apply.');
}

/** Applies a confirmed change through the services and records how to undo it. */
export async function apply(actionId: string): Promise<ApplyResult> {
    const action = await claim(actionId, 'pending', 'applying');
    try {
        const { undo, ...result } = await perform(actionId, action);
        await settle(actionId, (found) => {
            found.status = result.applied ? 'applied' : 'cancelled';
            found.undo = undo;
        });
        return result;
    } catch (error) {
        await settle(actionId, (found) => { found.status = 'pending'; });
        throw error;
    }
}

// ---------------------------------------------------------------- undo (step 9)

async function restore(actionId: string, undo: Undo): Promise<UndoResult> {
    if (undo.type === 'layout_change') {
        // "Before" may have been the level's default layout, with nothing saved
        if (undo.saved) await putLayout(undo.layout);
        else await updateState((state) => { state.layout = null; });
        return { restored: true, result: { layout: undo.layout }, message: 'The previous dashboard layout is back.' };
    }
    if (undo.type === 'rule_create') {
        const rule = (await listRules()).find((r) => r.id === undo.ruleId);
        if (!rule) return { restored: true, message: 'The rule no longer exists.' };
        // A rule that already fired stays, paused: its simulated trades refer to it
        if (rule.lastFiredAt) {
            await setRuleStatus(rule.id, 'paused');
            return { restored: true, result: { ruleId: rule.id, status: 'paused' }, message: 'The rule had already fired once, so it was paused instead of removed.' };
        }
        await updateState((state) => { state.rules = state.rules.filter((r) => r.id !== rule.id); });
        await appendDecision({ userId: DEMO_USER.id, kind: 'user_action', symbol: rule.symbol, payload: { action: 'rule_remove', rule, origin: 'agent undo', actionId, simulated: true } });
        return { restored: true, result: { ruleId: rule.id, removed: true }, message: 'The simulated rule was removed.' };
    }
    if (undo.type === 'rule_pause') {
        const rule = await setRuleStatus(undo.ruleId, undo.status);
        return { restored: true, result: { rule }, message: `The simulated rule is ${rule.status} again.` };
    }
    if (undo.type === 'profile_change') {
        const edit = await editProfile(undo.patch);
        return { restored: true, result: { before: edit.before, after: edit.after }, message: `The previous profile is back: level ${edit.after.level}, risk ${edit.after.risk}.` };
    }
    // The decision log is append-only, so a simulated trade is undone by the opposite simulated trade, at the price now
    const outcome = await simulateTrade({
        symbol: undo.symbol, side: undo.side === 'buy' ? 'sell' : 'buy', quantity: undo.quantity, origin: 'agent', acknowledgeConflict: true,
        reason: `undo of simulated trade ${undo.tradeId} (agent action ${actionId}): compensating simulated trade at the current price`,
    });
    if (outcome.status !== 'filled') return { restored: false, message: outcome.message };
    const { quantity, price, valueCad } = outcome.trade;
    return {
        restored: true, result: { trade: outcome.trade, cashCad: outcome.portfolio.cashCad },
        message: `Undo: a compensating simulated trade of ${quantity} units of ${undo.symbol} at ${money(price.value)} ${price.currency ?? ''} (${price.source}), ${money(valueCad)} CAD. Both trades stay in the log; cash can differ from before when the price moved.`,
    };
}

/** Puts back what an applied change replaced. */
export async function undo(actionId: string): Promise<UndoResult> {
    const action = await claim(actionId, 'applied', 'undoing');
    try {
        if (!action.undo) throw new ServiceError(409, 'This change holds nothing to undo.');
        const result = await restore(actionId, action.undo);
        await settle(actionId, (found) => { found.status = result.restored ? 'undone' : 'applied'; });
        return result;
    } catch (error) {
        await settle(actionId, (found) => { found.status = 'applied'; });
        throw error;
    }
}
