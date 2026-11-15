// Step 6 to 9 of an agent request: the action router. The agent service only proposes; this file decides what
// may run. A proposal whose type is not on the whitelist, or whose params do not pass their schema, is dropped.
// A change is first turned into a preview built from the app's own data, and runs only after the user confirms.
// Resetting the session is deliberately not an action: only the visitor can do it (POST /api/reset).
// Every exported function takes the visitor's scope last (default: the current request's session) and passes it
// on to every service it calls, so a proposal only ever reads and changes its own visitor's data.

import { createTranslator } from 'next-intl';
import { z } from 'zod';
import { describeAnswers, type Translator } from '@/components/onboarding/labels';
import type { Locale } from '@/i18n/config';
import { loadMessages } from '@/i18n/messages';
import type { AgentActionType, FilterCheck, InvestmentRule, OnboardingAnswers, ProposedAction, Sourced } from '@/lib/domain/types';
import { RULES } from '@/lib/rules';
import { ServiceError, round2 } from '@/lib/services/errors';
import { WIDGET_LIBRARY, getLayout, putLayout, validateLayout } from '@/lib/services/layout';
import { getPortfolioState, simulateTrade } from '@/lib/services/portfolio';
import { editProfile, getProfile, previewProfileEdit } from '@/lib/services/profile';
import { fxUsdCad, isTradable, liveQuote, signalsFor, toCad } from '@/lib/services/quotes';
import { createRule, listRules, ruleInputSchema, setRuleStatus, validateRule } from '@/lib/services/rules-engine';
import { currentScope, type Scope } from '@/lib/session';
import { appendDecision, readState, updateState, type PendingPreview } from '@/lib/store';
import { getEntry } from '@/lib/universe';
import { checkProfileConflict } from '@/lib/watchlist/conflict';
import { profileChangesSchema, toProfilePatch, type ProfileChanges } from './profile-changes';
import { agentText } from './text';
import { StrategyPreviewError, StrategyRefusal, applyStrategy, logStrategyConflict, previewStrategy, undoStrategy, type StrategyPreview, type StrategyUndo } from './strategy-propose';
import { strategyWords } from './strategy-words';

/** A refusal worded here, in the request's language. Any other ServiceError comes from another part of the app. */
class RouterError extends ServiceError {
    constructor(status: number, message: string, public detail?: string) {
        super(status, message);
    }
}

// ---------------------------------------------------------------- whitelist

const symbol = z.string().trim().min(1).max(20);
const tradeParams = z.object({ symbol, side: z.enum(['buy', 'sell']), amountCad: z.number().positive().optional(), quantity: z.number().positive().optional() }).strict()
    .refine((trade) => (trade.amountCad === undefined) !== (trade.quantity === undefined), 'give either amountCad or quantity');

/** The action types of the web app: the shared domain types plus strategy_propose (a whole strategy, B5). */
export type ActionType = AgentActionType | 'strategy_propose';

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
    // The strategy itself is checked by the strict schema of lib/strategy at preview time, so a refusal carries its issue codes
    strategy_propose: { confirm: true, params: z.object({ strategy: z.record(z.string(), z.unknown()), replaceId: z.string().trim().min(1).max(40).optional() }).strict() },
} satisfies Record<ActionType, { confirm: boolean; params: z.ZodTypeAny }>;

const envelope = z.object({ type: z.string(), summary: z.string().max(600).default(''), params: z.record(z.string(), z.unknown()).default({}) });

// ---------------------------------------------------------------- shapes

export type PreviewRow = { label: string; before: string; after: string };
export type PreviewFact = { label: string; value: string; source?: string; fetchedAt?: string; asOf?: string };
export type Preview = { before: unknown; after: unknown; summary: string; rows: PreviewRow[]; facts: PreviewFact[]; strategy?: StrategyPreview };

export type Routed =
    | { outcome: 'none' }
    // reason is shown to the user in their language; detail, when given, is the full reason for the action log
    | { outcome: 'dropped'; type: string; reason: string; detail?: string }
    | { outcome: 'info'; proposed: ProposedAction }
    | { outcome: 'preview'; proposed: ProposedAction; preview: Preview; conflicts: FilterCheck[] };

type Undo =
    | { type: 'layout_change'; layout: string[]; saved: boolean }
    | { type: 'rule_create'; ruleId: string }
    | { type: 'rule_pause'; ruleId: string; status: InvestmentRule['status'] }
    | { type: 'profile_change'; patch: { level: ProfileChanges['level']; risk: ProfileChanges['risk']; answers: OnboardingAnswers } }
    | { type: 'simulated_trade'; tradeId: string; symbol: string; side: 'buy' | 'sell'; quantity: number }
    | StrategyUndo;

type Status = 'pending' | 'applying' | 'applied' | 'undoing' | 'undone' | 'cancelled';
/** What the app-state document keeps per proposed change: the stored type's fields plus the preview and how to undo. */
export type StoredAction = PendingPreview & { status: Status; preview: Preview; conflicts: FilterCheck[]; undo?: Undo };

export type ApplyResult = { applied: boolean; undoable: boolean; result?: unknown; message: string; before?: unknown; after?: unknown };
export type UndoResult = { restored: boolean; result?: unknown; message: string };

const KEPT_ACTIONS = 100;
const priceFact = (label: string, price: Sourced, locale: Locale): PreviewFact => ({
    label, value: agentText(locale).price(price.value, price.currency), source: price.source, fetchedAt: price.fetchedAt, asOf: price.asOf,
});

/** The widget titles as the Portfolio tab shows them in this language; the library's own title otherwise. */
async function widgetTitles(locale: Locale): Promise<(id: string) => string> {
    const messages = (await loadMessages(locale).catch(() => ({}))) as { Portfolio?: { modules?: Record<string, string> } };
    const modules = messages.Portfolio?.modules ?? {};
    return (id: string) => modules[id] ?? WIDGET_LIBRARY.find((widget) => widget.id === id)?.title ?? id;
}

/** The onboarding wording in this language, for the profile preview's questions and answers. */
async function onboardingTranslator(locale: Locale): Promise<Translator | undefined> {
    if (locale === 'en') return undefined;
    const messages = (await loadMessages(locale).catch(() => ({}))) as Record<string, unknown>;
    if (!messages.Onboarding) return undefined;
    return createTranslator({ locale, messages: { Onboarding: messages.Onboarding } as never, namespace: 'Onboarding' as never }) as unknown as Translator;
}

// ---------------------------------------------------------------- previews

async function layoutPreview(after: string[], locale: Locale, scope: Scope): Promise<Preview> {
    const text = agentText(locale);
    const errors = validateLayout(after);
    if (errors.length > 0) throw new ServiceError(400, errors.join(' '));
    const { layout: before } = await getLayout(undefined, scope);
    if (before.join('|') === after.join('|')) throw new RouterError(400, text.sameLayout);
    const title = await widgetTitles(locale);
    const listed = (values: readonly string[]) => (values.length > 0 ? values.join(', ') : text.none);
    const onTab = (ids: string[], tab: string) => listed(ids.filter((id) => WIDGET_LIBRARY.find((widget) => widget.id === id)?.tab === tab).map(title));
    // Only the Portfolio tab is drawn from the layout; the Overview tab is fixed.
    const removed = before.filter((id) => !after.includes(id)).map(title);
    const added = after.filter((id) => !before.includes(id)).map(title);
    return {
        before, after,
        summary: text.layoutSummary(removed, added),
        rows: [
            { label: text.portfolioTab, before: onTab(before, 'portfolio'), after: onTab(after, 'portfolio') },
        ],
        facts: [],
    };
}

/** The rule in one fixed sentence, written from its fields. Price triggers are in the asset's quote currency. */
export function ruleSentence(rule: Pick<InvestmentRule, 'symbol' | 'trigger' | 'action' | 'once'>, currency = '', locale: Locale = 'en'): string {
    return agentText(locale).ruleSentence(rule, currency);
}

async function rulePreview(input: z.infer<typeof ruleInputSchema>, locale: Locale, scope: Scope): Promise<Preview> {
    const words = agentText(locale);
    const checked = await validateRule(input, undefined, scope);
    // The rules engine words its errors in English: the French sentence is shown, the log keeps the errors
    if (!checked.ok) throw new RouterError(400, words.ruleInvalid(checked.errors), checked.errors.join(' '));
    const sentence = ruleSentence(checked.rule, checked.currentPrice?.currency, locale);
    const { symbol: ruleSymbol, trigger, action, once, text } = checked.rule;
    return {
        before: null,
        after: { rule: { text, symbol: ruleSymbol, trigger, action, once }, sentence },
        summary: words.ruleSummary(ruleSymbol),
        rows: [{ label: words.ruleLabel, before: words.noRule, after: sentence }, { label: words.yourWording, before: '', after: text }],
        facts: checked.currentPrice ? [priceFact(words.lastPrice(ruleSymbol), checked.currentPrice, locale)] : [],
    };
}

async function rulePausePreview(ruleId: string, status: InvestmentRule['status'], locale: Locale, scope: Scope): Promise<Preview> {
    const words = agentText(locale);
    const rule = (await listRules(scope)).find((r) => r.id === ruleId);
    if (!rule) throw new RouterError(404, words.noRuleWithId(ruleId));
    if (rule.status === status) throw new RouterError(400, words.ruleAlready(status));
    return {
        before: { ruleId, status: rule.status },
        after: { ruleId, status },
        summary: words.pauseSummary(status, rule.symbol),
        rows: [
            { label: words.statusLabel, before: words.ruleStatus(rule.status), after: words.ruleStatus(status) },
            { label: words.ruleLabel, before: ruleSentence(rule, '', locale), after: ruleSentence(rule, '', locale) },
        ],
        facts: [],
    };
}

async function profilePreview(changes: ProfileChanges, locale: Locale, scope: Scope): Promise<Preview> {
    const words = agentText(locale);
    const existing = await getProfile(undefined, scope);
    const patch = toProfilePatch(changes);
    const edit = await previewProfileEdit(patch, scope);    // refuses when no profile exists
    const fields = Object.keys(patch.answers ?? {}) as Array<keyof OnboardingAnswers>;
    const changed = fields.filter((field) => JSON.stringify(existing!.answers[field]) !== JSON.stringify(edit.profile.answers[field]));
    if (changed.length === 0 && edit.before.level === edit.after.level && edit.before.risk === edit.after.risk) {
        throw new RouterError(400, words.sameProfile);
    }
    const pick = (answers: OnboardingAnswers) => Object.fromEntries(changed.map((field) => [field, answers[field]]));
    // Shown with the onboarding's own question and answer wording, never the stored field names and values
    const t = await onboardingTranslator(locale);
    const worded = (answers: OnboardingAnswers) => new Map((t ? describeAnswers(answers, t, locale) : describeAnswers(answers)).map(({ question, answer }) => [question, answer]));
    const was = worded(existing!.answers);
    const now = worded(edit.profile.answers);
    const answerRows = [...new Set([...was.keys(), ...now.keys()])].filter((question) => was.get(question) !== now.get(question))
        .map((question) => ({ label: question, before: was.get(question) ?? words.notAsked, after: now.get(question) ?? words.notAsked }));
    const named = [...answerRows.map((row) => row.label), ...(patch.level !== undefined ? [words.levelLabel] : []), ...(patch.risk !== undefined ? [words.riskLabel] : [])];
    const { levelResult, riskResult } = edit.profile;
    return {
        before: { ...edit.before, answers: pick(existing!.answers) },
        after: { ...edit.after, answers: pick(edit.profile.answers) },
        summary: words.profileSummary(named),
        rows: [
            { label: words.levelLabel, before: words.level(edit.before.level), after: words.level(edit.after.level) },
            { label: words.riskLabel, before: words.risk(edit.before.risk), after: words.risk(edit.after.risk) },
            ...answerRows,
        ],
        facts: [
            { label: words.levelRule(levelResult.ruleVersion), value: words.rulePoints(words.level(levelResult.level), levelResult.points, edit.profile.levelOverridden), source: words.derived },
            { label: words.riskRule(riskResult.ruleVersion), value: words.rulePoints(words.risk(riskResult.risk), riskResult.points, edit.profile.riskOverridden), source: words.derived },
        ],
    };
}

async function tradePreview(params: z.infer<typeof tradeParams>, locale: Locale, scope: Scope): Promise<{ preview: Preview; conflicts: FilterCheck[]; symbol: string }> {
    const words = agentText(locale);
    const entry = getEntry(params.symbol);
    if (!entry) throw new RouterError(404, words.notInList(params.symbol));
    if (!isTradable(entry)) throw new RouterError(400, words.referenceOnly(entry.name));
    const profile = await getProfile(undefined, scope);
    if (!profile) throw new RouterError(409, words.noProfile);
    const quote = await liveQuote(entry).catch(() => null);
    if (!quote) throw new RouterError(502, words.noPrice(entry.symbol));
    const fx = quote.price.currency === 'CAD' ? undefined : await fxUsdCad().catch(() => undefined);
    const unitCad = toCad(quote.price.value, quote.price.currency, fx);
    if (unitCad === null) throw new RouterError(502, words.noCad(entry.symbol));

    const quantity = params.quantity ?? params.amountCad! / unitCad;
    const valueCad = round2(quantity * unitCad);
    const portfolio = await getPortfolioState(scope);
    const held = portfolio.positions.find((position) => position.symbol === entry.symbol)?.quantity ?? 0;
    const purchase = params.side === 'buy';
    if (purchase && valueCad > portfolio.cashCad) throw new RouterError(400, words.notEnoughCash(portfolio.cashCad, valueCad));
    if (!purchase && quantity > held + 1e-6) throw new RouterError(400, words.notEnoughUnits(entry.symbol, held, quantity));

    let conflicts: FilterCheck[] = [];
    if (purchase) {
        const { signals, fxUsdCad: signalFx } = await signalsFor(entry);
        conflicts = checkProfileConflict(signals, profile, RULES, signalFx ?? fx).conflicts;
    }
    const sign = purchase ? 1 : -1;
    const cashAfter = round2(portfolio.cashCad - sign * valueCad);
    const heldAfter = Math.max(0, held + sign * quantity);
    return {
        symbol: entry.symbol,
        conflicts,
        preview: {
            before: { cashCad: portfolio.cashCad, quantity: held },
            after: { cashCad: cashAfter, quantity: Number(heldAfter.toFixed(6)), estimate: true },
            summary: purchase ? words.purchaseSummary(valueCad, entry.symbol, entry.name) : words.reductionSummary(valueCad, entry.symbol, entry.name),
            rows: [
                { label: words.cashLabel, before: words.cad(portfolio.cashCad), after: words.about(words.cad(cashAfter)) },
                { label: words.positionLabel(entry.symbol), before: words.units(held), after: words.about(words.units(heldAfter)) },
            ],
            facts: [
                priceFact(words.lastPrice(entry.symbol), quote.price, locale),
                ...(fx && quote.price.currency !== 'CAD' ? [{ label: words.fxLabel, value: words.fx(fx.value), source: fx.source, fetchedAt: fx.fetchedAt, asOf: fx.asOf }] : []),
                { label: words.fillLabel, value: words.fillValue, source: words.derived },
            ],
        },
    };
}

// ---------------------------------------------------------------- route (step 6 and 7)

const stored = async (actionId: string, scope: Scope) => (await readState(scope)).pendingPreviews.find((p) => p.actionId === actionId) as StoredAction | undefined;

/** Atomically moves an action from one status to another; refuses when it is in any other status. */
async function claim(actionId: string, from: Status, to: Status, locale: Locale, scope: Scope): Promise<StoredAction> {
    let found: StoredAction | undefined;
    let was: Status | undefined;
    await updateState(scope, (state) => {
        found = state.pendingPreviews.find((p) => p.actionId === actionId) as StoredAction | undefined;
        was = found?.status;
        if (found && was === from) found.status = to;
    });
    if (!found) throw new ServiceError(404, agentText(locale).noSuchChange);
    if (was !== from) throw new ServiceError(409, agentText(locale).wrongStatus(was, from, to));
    return found;
}

const settle = (actionId: string, scope: Scope, change: (action: StoredAction) => void) => updateState(scope, (state) => {
    const found = state.pendingPreviews.find((p) => p.actionId === actionId) as StoredAction | undefined;
    if (found) change(found);
});

/** Checks a proposal against the whitelist. A change gets its preview stored; nothing is applied here. */
export async function route(actionId: string, proposal: unknown, locale: Locale = 'en', scope?: Scope): Promise<Routed> {
    const words = agentText(locale);
    if (proposal === undefined || proposal === null) return { outcome: 'none' };
    const outer = envelope.safeParse(proposal);
    if (!outer.success) return { outcome: 'dropped', type: 'unknown', reason: words.badForm };
    const { type, summary } = outer.data;
    if (!Object.hasOwn(ACTIONS, type)) return { outcome: 'dropped', type, reason: words.notAllowed(type) };
    const kind = type as ActionType;
    // A model writes null for a field it leaves out
    const given = Object.fromEntries(Object.entries(outer.data.params).filter(([, value]) => value !== null));
    const parsed = ACTIONS[kind].params.safeParse(given);
    if (!parsed.success) {
        const detail = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'params'}: ${issue.message}`).join('; ');
        const reason = words.paramsInvalid(type, detail);
        return { outcome: 'dropped', type, reason, ...(reason.includes(detail) ? {} : { detail }) };
    }
    const params = parsed.data as Record<string, unknown>;
    if (!ACTIONS[kind].confirm) return { outcome: 'info', proposed: { type: kind as AgentActionType, summary, params, needsConfirm: false } };

    const s = scope ?? await currentScope();
    let preview: Preview;
    let conflicts: FilterCheck[] = [];
    try {
        if (kind === 'layout_change') preview = await layoutPreview(params.layout as string[], locale, s);
        else if (kind === 'rule_create') preview = await rulePreview(params.rule as z.infer<typeof ruleInputSchema>, locale, s);
        else if (kind === 'rule_pause') preview = await rulePausePreview(params.ruleId as string, params.status as InvestmentRule['status'], locale, s);
        else if (kind === 'profile_change') preview = await profilePreview(params.changes as ProfileChanges, locale, s);
        else if (kind === 'strategy_propose') {
            const built = await previewStrategy(params.strategy as Record<string, unknown>, params.replaceId as string | undefined, locale, s);
            const words = strategyWords(locale);
            preview = {
                before: built.preview.beforeSentences ? { strategyId: built.preview.replaceId, sentences: built.preview.beforeSentences } : null,
                after: { strategy: built.strategy, sentences: built.preview.sentences, replay: built.preview.replay },
                summary: built.summary,
                rows: [{ label: words.strategyLabel, before: built.preview.beforeSentences?.join(' ') ?? words.noStrategy, after: built.strategy.name }],
                facts: built.preview.replay ? [{ label: words.replayLabel, value: words.replayIds(built.preview.replay.replayId, built.preview.replay.snapshotId), source: words.derived }] : [],
                strategy: built.preview,
            };
            conflicts = built.conflicts;
            // The validated strategy (ids filled in, values normalised) is what a confirmation saves
            params.strategy = { name: built.strategy.name, rules: built.strategy.rules };
            await logStrategyConflict(s, actionId, built.conflicts, false, { strategy: built.strategy, signals: built.signals });
        } else {
            const trade = await tradePreview(params as z.infer<typeof tradeParams>, locale, s);
            ({ preview, conflicts } = trade);
            params.symbol = trade.symbol;
        }
    } catch (error) {
        if (error instanceof StrategyRefusal) {
            const codes = error.issues.map((issue) => `${issue.code}@${issue.path}`).join(', ');
            return { outcome: 'dropped', type, reason: strategyWords(locale).invalid(error.messages), detail: `strategy issues: ${codes}` };
        }
        if (error instanceof StrategyPreviewError) return { outcome: 'dropped', type, reason: error.message };
        if (error instanceof RouterError) return { outcome: 'dropped', type, reason: error.message, ...(error.detail && locale !== 'en' ? { detail: error.detail } : {}) };
        if (error instanceof ServiceError) {
            // Worded by another part of the app, in English: shown as is in English, replaced in French (the log keeps it)
            const reason = words.otherError(error.message);
            return { outcome: 'dropped', type, reason, ...(reason === error.message ? {} : { detail: error.message }) };
        }
        throw error;
    }
    // The preview's sentence is written here from the app's data; the model's own summary is not shown
    const proposed: ProposedAction = { type: kind as AgentActionType, summary: preview.summary, before: preview.before, after: preview.after, params, needsConfirm: true };
    const record: StoredAction = { actionId, createdAt: new Date().toISOString(), proposed, status: 'pending', preview, conflicts };
    await updateState(s, (state) => {
        state.pendingPreviews = [...state.pendingPreviews.filter((p) => p.actionId !== actionId), record].slice(-KEPT_ACTIONS);
    });
    return { outcome: 'preview', proposed, preview, conflicts };
}

export const getAction = async (actionId: string, scope?: Scope): Promise<StoredAction | undefined> => stored(actionId, scope ?? await currentScope());

export async function cancel(actionId: string, locale: Locale = 'en', scope?: Scope): Promise<StoredAction> {
    const action = await claim(actionId, 'pending', 'cancelled', locale, scope ?? await currentScope());
    return { ...action, status: 'cancelled' };
}

// ---------------------------------------------------------------- apply (step 8)

async function perform(actionId: string, action: StoredAction, locale: Locale, scope: Scope): Promise<ApplyResult & { undo?: Undo }> {
    const words = agentText(locale);
    const { params } = action.proposed;
    const type = action.proposed.type as ActionType;
    if (type === 'strategy_propose') {
        // The user confirmed a preview that named these conflicts: logged again, as a decision to go ahead in simulation
        await logStrategyConflict(scope, actionId, action.conflicts, true);
        const { saved, undo: back } = await applyStrategy(params as { strategy: Record<string, unknown>; replaceId?: string }, scope);
        return {
            applied: true, undoable: true, result: { strategy: saved, timeMachine: `/time-machine?strategy=${encodeURIComponent(saved.id)}` },
            before: action.preview.before, after: { strategyId: saved.id, version: saved.version },
            message: strategyWords(locale).saved(saved.name, saved.id, saved.version), undo: back,
        };
    }
    if (type === 'layout_change') {
        const current = await getLayout(undefined, scope);
        const { layout } = await putLayout(params.layout, scope);
        return { applied: true, undoable: true, result: { layout }, before: current.layout, after: layout, message: words.layoutApplied, undo: { type, layout: current.layout, saved: current.saved } };
    }
    if (type === 'rule_create') {
        const rule = await createRule(params.rule, scope);
        return { applied: true, undoable: true, result: { rule }, before: null, after: rule, message: words.ruleCreated(rule.symbol, rule.id), undo: { type, ruleId: rule.id } };
    }
    if (type === 'rule_pause') {
        const before = (await listRules(scope)).find((r) => r.id === params.ruleId);
        if (!before) throw new ServiceError(404, words.noRuleWithId(String(params.ruleId)));
        const rule = await setRuleStatus(before.id, params.status as InvestmentRule['status'], scope);
        return { applied: true, undoable: true, result: { rule }, before: { status: before.status }, after: { status: rule.status }, message: words.ruleNowStatus(rule.symbol, rule.status), undo: { type, ruleId: rule.id, status: before.status } };
    }
    if (type === 'profile_change') {
        const existing = await getProfile(undefined, scope);
        if (!existing) throw new ServiceError(404, words.noProfile);
        const edit = await editProfile(toProfilePatch(params.changes as ProfileChanges), scope);
        return {
            applied: true, undoable: true, result: { before: edit.before, after: edit.after }, before: action.preview.before, after: action.preview.after,
            message: words.profileApplied(edit.after.level, edit.after.risk),
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
        }, locale, scope);
        if (outcome.status === 'conflict') return { applied: false, undoable: false, result: { conflicts: outcome.conflicts }, message: outcome.message };
        const { id, symbol: traded, quantity, price, valueCad, side } = outcome.trade;
        return {
            applied: true, undoable: true, result: { trade: outcome.trade, cashCad: outcome.portfolio.cashCad, conflicts: outcome.conflicts },
            before: action.preview.before, after: { cashCad: outcome.portfolio.cashCad, tradeId: id },
            message: words.tradeApplied(quantity, traded, words.price(price.value, price.currency), price.source, valueCad, outcome.portfolio.cashCad),
            undo: { type, tradeId: id, symbol: traded, side, quantity },
        };
    }
    throw new ServiceError(400, words.nothingToApply);
}

/** Applies a confirmed change through the services and records how to undo it. */
export async function apply(actionId: string, locale: Locale = 'en', scope?: Scope): Promise<ApplyResult> {
    const s = scope ?? await currentScope();
    const action = await claim(actionId, 'pending', 'applying', locale, s);
    try {
        const { undo, ...result } = await perform(actionId, action, locale, s);
        await settle(actionId, s, (found) => {
            found.status = result.applied ? 'applied' : 'cancelled';
            found.undo = undo;
        });
        return result;
    } catch (error) {
        await settle(actionId, s, (found) => { found.status = 'pending'; });
        throw error;
    }
}

// ---------------------------------------------------------------- undo (step 9)

async function restore(actionId: string, undo: Undo, locale: Locale, scope: Scope): Promise<UndoResult> {
    const words = agentText(locale);
    if (undo.type === 'strategy_propose') {
        const done = await undoStrategy(actionId, undo, scope);
        const say = strategyWords(locale);
        if (done.outcome === 'gone') return { restored: true, message: say.gone };
        if (done.outcome === 'restored') return { restored: true, result: { strategy: done.strategy }, message: say.restored(done.strategy!.name, done.strategy!.version) };
        return { restored: true, result: { strategyId: undo.strategyId, removed: true }, message: say.removed(done.strategy?.name ?? undo.strategyId) };
    }
    if (undo.type === 'layout_change') {
        // "Before" may have been the level's default layout, with nothing saved
        if (undo.saved) await putLayout(undo.layout, scope);
        else await updateState(scope, (state) => { state.layout = null; });
        return { restored: true, result: { layout: undo.layout }, message: words.layoutRestored };
    }
    if (undo.type === 'rule_create') {
        const rule = (await listRules(scope)).find((r) => r.id === undo.ruleId);
        if (!rule) return { restored: true, message: words.ruleGone };
        // A rule that already fired stays, paused: its simulated trades refer to it
        if (rule.lastFiredAt) {
            await setRuleStatus(rule.id, 'paused', scope);
            return { restored: true, result: { ruleId: rule.id, status: 'paused' }, message: words.rulePausedInstead };
        }
        await updateState(scope, (state) => { state.rules = state.rules.filter((r) => r.id !== rule.id); });
        await appendDecision({ userId: scope.portfolioUserId, kind: 'user_action', symbol: rule.symbol, payload: { action: 'rule_remove', rule, origin: 'agent undo', actionId, simulated: true } });
        return { restored: true, result: { ruleId: rule.id, removed: true }, message: words.ruleRemoved };
    }
    if (undo.type === 'rule_pause') {
        const rule = await setRuleStatus(undo.ruleId, undo.status, scope);
        return { restored: true, result: { rule }, message: words.ruleAgain(rule.status) };
    }
    if (undo.type === 'profile_change') {
        const edit = await editProfile(undo.patch, scope);
        return { restored: true, result: { before: edit.before, after: edit.after }, message: words.profileRestored(edit.after.level, edit.after.risk) };
    }
    // The decision log is append-only, so a simulated trade is undone by the opposite simulated trade, at the price now
    const outcome = await simulateTrade({
        symbol: undo.symbol, side: undo.side === 'buy' ? 'sell' : 'buy', quantity: undo.quantity, origin: 'agent', acknowledgeConflict: true,
        reason: `undo of simulated trade ${undo.tradeId} (agent action ${actionId}): compensating simulated trade at the current price`,
    }, locale, scope);
    if (outcome.status !== 'filled') return { restored: false, message: outcome.message };
    const { quantity, price, valueCad } = outcome.trade;
    return {
        restored: true, result: { trade: outcome.trade, cashCad: outcome.portfolio.cashCad },
        message: words.tradeUndone(quantity, undo.symbol, words.price(price.value, price.currency), price.source, valueCad),
    };
}

/** Puts back what an applied change replaced. */
export async function undo(actionId: string, locale: Locale = 'en', scope?: Scope): Promise<UndoResult> {
    const s = scope ?? await currentScope();
    const action = await claim(actionId, 'applied', 'undoing', locale, s);
    try {
        if (!action.undo) throw new ServiceError(409, agentText(locale).nothingToUndo);
        const result = await restore(actionId, action.undo, locale, s);
        await settle(actionId, s, (found) => { found.status = result.restored ? 'undone' : 'applied'; });
        return result;
    } catch (error) {
        await settle(actionId, s, (found) => { found.status = 'applied'; });
        throw error;
    }
}
