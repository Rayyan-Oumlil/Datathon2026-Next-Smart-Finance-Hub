// The demo rules engine (spec section 11): rules live in the visitor's app-state document, the engine reads the last quote and,
// on a hit, simulates a fill at that price. No broker, no real trade.
//
// Whether a rule fires is decided by the ONE evaluator shared with the replay (lib/strategy/evaluate.ts): this file
// only builds the live state (cash, positions, last quotes) for it and fills what it decides through simulateTrade.
// Strategies (named sets of rules, including the V2 rule kinds) are stored here too; they are evaluated live on
// request and nothing is executed for them. There is no server-side scheduler.

import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { getAppLocale } from '@/i18n/locale';
import { RULES, RULES_VERSION } from '@/lib/rules';
import type { InvestmentRule, SimulatedTrade, Sourced, TextRef } from '@/lib/domain/types';
import { marketDate } from '@/lib/sources/daily-signals';
import { currentScope, type Scope } from '@/lib/session';
import { appendDecision, readState, updateState } from '@/lib/store';
import { getEntry } from '@/lib/universe';
import type { Locale } from '@/lib/watchlist/text';
import { ServiceError } from './errors';
import { getPortfolioState, simulateTrade } from './portfolio';
import { fxUsdCad, isTradable, liveQuote, toCad } from './quotes';
import { issueRef, renderText, serviceRef } from './text';
import { STRATEGY_CONFIG } from '@/lib/strategy/config';
import { evaluateRules as evaluateShared, portfolioValueCad, testPriceTrigger, type Evaluation, type PortfolioState, type PricePoint, type RuleCondition, type RuleEvent, type SkippedRule } from '@/lib/strategy/evaluate';
import { bothLanguages, dropTextRef, eventTextRef, type Sentence } from '@/lib/strategy/sentence';
import { fromInvestmentRule, parseStrategy, strategySymbols, type Strategy, type StrategyIssue, type StrategyRule } from '@/lib/strategy/types';

const TRIGGER_TYPES = ['price_below', 'price_above', 'change_pct_below', 'change_pct_above'] as const;

export const ruleInputSchema = z.object({
    text: z.string().trim().min(1, 'the rule needs its wording').max(300),
    symbol: z.string().trim().min(1).max(20),
    trigger: z.object({ type: z.enum(TRIGGER_TYPES), value: z.number().finite() }),
    action: z.object({ side: z.enum(['buy', 'sell']), amountCad: z.number().positive().optional(), quantity: z.number().positive().optional() }),
    once: z.boolean().default(true),
});
export type RuleInput = z.input<typeof ruleInputSchema>;

export type RuleValidation =
    | { ok: true; rule: InvestmentRule; currentPrice?: Sourced }
    | { ok: false; errors: string[]; currentPrice?: Sourced };

export type RuleCheck = { ruleId: string; symbol: string; hit: boolean; fired: boolean; note: string; price?: Sourced };

const isPriceTrigger = (type: InvestmentRule['trigger']['type']) => type === 'price_below' || type === 'price_above';
const languageOf = async (locale?: Locale): Promise<Locale> => locale ?? getAppLocale();
// Every function here takes the visitor's scope last; without one it uses the current request's session.
const scopeOr = async (scope?: Scope): Promise<Scope> => scope ?? currentScope();

/** validateRule with each problem as a catalog reference, so a caller can show them in either language. */
async function checkRule(input: unknown, scope: Scope): Promise<{ ok: true; rule: InvestmentRule; currentPrice?: Sourced } | { ok: false; refs: TextRef[]; currentPrice?: Sourced }> {
    const parsed = ruleInputSchema.safeParse(input);
    if (!parsed.success) return { ok: false, refs: parsed.error.issues.map((issue) => issueRef(issue, 'rule')) };
    const { text, trigger, action, once } = parsed.data;
    const errors: TextRef[] = [];

    const entry = getEntry(parsed.data.symbol);
    if (!entry) errors.push(serviceRef('svc.not_in_universe', { symbol: parsed.data.symbol }));
    else if (!isTradable(entry)) errors.push(serviceRef('svc.reference_value', { name: entry.name }));

    if (isPriceTrigger(trigger.type) && !(trigger.value > 0)) errors.push(serviceRef('svc.rule.price_trigger', {}));
    if (!isPriceTrigger(trigger.type) && (trigger.value === 0 || Math.abs(trigger.value) > 100)) errors.push(serviceRef('svc.rule.change_trigger', {}));
    if ((action.amountCad === undefined) === (action.quantity === undefined)) errors.push(serviceRef('svc.rule.amount_or_quantity', {}));

    const quote = entry && isTradable(entry) ? await liveQuote(entry).catch(() => null) : null;
    if (entry && isTradable(entry) && !quote) errors.push(serviceRef('svc.rule.no_price', { symbol: entry.symbol }));

    if (entry && errors.length === 0) {
        const portfolio = await getPortfolioState(scope);
        if (action.side === 'buy') {
            const fx = quote!.price.currency === 'CAD' ? undefined : await fxUsdCad().catch(() => undefined);
            const unitCad = toCad(quote!.price.value, quote!.price.currency, fx);
            const cost = action.amountCad ?? (unitCad === null ? null : action.quantity! * unitCad);
            if (cost === null) errors.push(serviceRef('svc.rule.no_conversion', { symbol: entry.symbol }));
            else if (cost > portfolio.cashCad) errors.push(serviceRef('svc.rule.cash_short', { cash: portfolio.cashCad, cost }));
        } else {
            const held = portfolio.positions.find((position) => position.symbol === entry.symbol);
            if (!held) errors.push(serviceRef('svc.rule.nothing_to_reduce', { symbol: entry.symbol }));
            else if (action.quantity !== undefined && action.quantity > held.quantity) errors.push(serviceRef('svc.rule.position_short', { symbol: entry.symbol, held: held.quantity, quantity: action.quantity }));
        }
    }
    if (errors.length > 0 || !entry) return { ok: false, refs: errors, currentPrice: quote?.price };

    const rule: InvestmentRule = {
        id: `rule_${randomBytes(4).toString('hex')}`,
        createdAt: new Date().toISOString(),
        status: 'active',
        text,
        symbol: entry.symbol,
        trigger,
        action,
        once,
    };
    return { ok: true, rule, currentPrice: quote?.price };
}

/** Checks a rule against the universe, the last price and the simulated portfolio. Nothing is saved. Errors are in `locale` (default: the request's). */
export async function validateRule(input: unknown, locale?: Locale, scope?: Scope): Promise<RuleValidation> {
    const lang = await languageOf(locale);
    const checked = await checkRule(input, await scopeOr(scope));
    if (checked.ok) return checked;
    return { ok: false, errors: checked.refs.map((ref) => renderText(ref, lang)), currentPrice: checked.currentPrice };
}

const logRuleAction = (scope: Scope, rule: InvestmentRule, action: string) =>
    appendDecision({ userId: scope.portfolioUserId, kind: 'user_action', symbol: rule.symbol, ruleVersions: { rules: RULES_VERSION, filters: RULES.filters.version }, payload: { action, rule, simulated: true } });

export async function createRule(input: unknown, scope?: Scope): Promise<InvestmentRule> {
    const s = await scopeOr(scope);
    const checked = await checkRule(input, s);
    if (!checked.ok) throw new ServiceError(400, serviceRef('svc.joined', { items: checked.refs }));
    await updateState(s, (state) => {
        state.rules.push(checked.rule);
    });
    await logRuleAction(s, checked.rule, 'rule_create');
    return checked.rule;
}

export async function setRuleStatus(id: string, status: InvestmentRule['status'], scope?: Scope): Promise<InvestmentRule> {
    const s = await scopeOr(scope);
    let changed: InvestmentRule | undefined;
    let spent = false;
    await updateState(s, (state) => {
        changed = state.rules.find((rule) => rule.id === id);
        // A once-rule that has fired never fires again: resuming it would show an active rule that does nothing
        spent = Boolean(changed && status === 'active' && changed.once && changed.lastFiredAt);
        if (changed && !spent) changed.status = status;
    });
    if (!changed) throw new ServiceError(404, serviceRef('svc.rule.unknown_id', { id }));
    if (spent) throw new ServiceError(409, serviceRef('svc.rule.spent', {}));
    await logRuleAction(s, changed, status === 'paused' ? 'rule_pause' : 'rule_resume');
    return changed;
}

export const listRules = async (scope?: Scope): Promise<InvestmentRule[]> => (await readState(await scopeOr(scope))).rules;

type PriceCondition = Extract<RuleCondition, { kind: 'price_threshold' }>;

/** The factual sentence of a price-threshold test, as a catalog reference: the trade's reason on a hit, the check's note otherwise. */
function factRefOf(condition: Pick<PriceCondition, 'trigger' | 'threshold' | 'price' | 'currency' | 'changePct' | 'met'>): TextRef {
    const relation = condition.trigger === 'price_below' || condition.trigger === 'change_pct_below' ? 'below' : 'above';
    if (isPriceTrigger(condition.trigger)) return serviceRef('svc.rule.fact_price', { price: condition.price, value: condition.threshold, currency: condition.currency, hit: condition.met, relation });
    if (condition.changePct === null) return serviceRef('svc.rule.fact_no_change', {});
    return serviceRef('svc.rule.fact_change', { change: condition.changePct, value: condition.threshold, hit: condition.met, relation });
}

/**
 * Tests a trigger against a quote. Returns whether it hit and the factual sentence used as the trade's reason (or
 * the check's note), in `locale` (default English), with its catalog reference. The test itself is the shared
 * evaluator's (testPriceTrigger).
 */
export function testTrigger(rule: InvestmentRule, price: Sourced, changePercent?: Sourced, locale: Locale = 'en'): { hit: boolean; fact: string; factRef: TextRef } {
    const hit = testPriceTrigger(rule.trigger, { price: price.value, changePct: changePercent?.value });
    const factRef = factRefOf({ trigger: rule.trigger.type, threshold: rule.trigger.value, price: price.value, currency: price.currency ?? '', changePct: changePercent?.value ?? null, met: hit });
    return { hit, fact: renderText(factRef, locale), factRef };
}

// ---------------------------------------------------------------- the live state given to the shared evaluator

const DAY_MS = 24 * 60 * 60 * 1000;
/** Weekdays since 1970-01-01 for a market date: the live "trading day" counter (holidays are not known here). */
export function tradingDayIndex(date: string): number {
    const days = Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
    const weeks = Math.floor((days + 3) / 7);            // 1970-01-01 was a Thursday
    const weekday = ((days + 3) % 7 + 7) % 7;            // 0 = Monday
    return weeks * 5 + Math.min(weekday, 5);
}

export type LiveState = { state: PortfolioState; quotes: Record<string, Sourced>; checkedAt: string };

/**
 * The simulated portfolio as the evaluator reads it: cash, units, and the last quote of each symbol asked for (in
 * its listing currency and in CAD). A symbol with no quote or no conversion is left out of `prices`.
 */
async function liveState(scope: Scope, symbols: string[], memory: Pick<PortfolioState, 'lastFiredDay' | 'guardActive' | 'spent'>, peakValueCad = 0): Promise<LiveState> {
    const checkedAt = new Date().toISOString();
    const date = marketDate(new Date(checkedAt));
    const portfolio = await getPortfolioState(scope);
    const prices: Record<string, PricePoint> = {};
    const quotes: Record<string, Sourced> = {};
    let fx: Sourced | undefined;
    let fxAsked = false;
    for (const symbol of [...new Set(symbols)].sort()) {
        const entry = getEntry(symbol);
        const quote = entry ? await liveQuote(entry).catch(() => null) : null;
        if (!quote) continue;
        if (quote.price.currency !== 'CAD' && !fxAsked) {
            fxAsked = true;
            fx = await fxUsdCad().catch(() => undefined);
        }
        const priceCad = toCad(quote.price.value, quote.price.currency, fx);
        if (priceCad === null) continue;
        quotes[symbol] = quote.price;
        prices[symbol] = { price: quote.price.value, currency: quote.price.currency ?? '', priceCad, ...(quote.changePercent ? { changePct: quote.changePercent.value } : {}) };
    }
    const positions = Object.fromEntries(portfolio.positions.map((position) => [position.symbol, position.quantity]));
    const book = { cashCad: portfolio.cashCad, positions };
    const state: PortfolioState = {
        dayIndex: tradingDayIndex(date),
        date,
        cashCad: portfolio.cashCad,
        positions,
        prices,
        peakValueCad: Math.max(peakValueCad, portfolioValueCad(book, prices)),
        ...memory,
    };
    return { state, quotes, checkedAt };
}

/** What a stored V1 rule remembers, as the evaluator's firing memory. */
function memoryOf(rules: InvestmentRule[]): Pick<PortfolioState, 'lastFiredDay' | 'guardActive' | 'spent'> {
    const memory: Pick<PortfolioState, 'lastFiredDay' | 'guardActive' | 'spent'> = { lastFiredDay: {}, guardActive: {}, spent: {} };
    for (const rule of rules) {
        if (!rule.lastFiredAt) continue;
        memory.lastFiredDay[rule.id] = tradingDayIndex(marketDate(new Date(rule.lastFiredAt)));
        if (rule.once) memory.spent[rule.id] = true;
    }
    return memory;
}

/**
 * The live entry point of the shared evaluator for the stored V1 rules: the active rules on the live state. Decides,
 * executes nothing. evaluateRules below fills what this returns; the replay calls the same evaluator on its own state.
 */
export async function evaluateLiveRules(scope?: Scope): Promise<LiveState & { rules: InvestmentRule[]; evaluation: Evaluation }> {
    const s = await scopeOr(scope);
    const rules = (await readState(s)).rules.filter((rule) => rule.status === 'active');
    const live = await liveState(s, rules.map((rule) => rule.symbol), memoryOf(rules));
    const evaluation = evaluateShared(live.state, rules.map(fromInvestmentRule), { config: STRATEGY_CONFIG, baseWeights: {} });
    return { ...live, rules, evaluation };
}

async function evaluate(locale: Locale, scope: Scope): Promise<{ fired: SimulatedTrade[]; checkedAt: string; checks: RuleCheck[] }> {
    const say = (ref: TextRef) => renderText(ref, locale);
    const { rules, evaluation, quotes, checkedAt } = await evaluateLiveRules(scope);
    const fired: SimulatedTrade[] = [];
    const checks: RuleCheck[] = [];
    const eventOf = new Map<string, RuleEvent>(evaluation.events.map((event) => [event.ruleId, event]));
    const skipOf = new Map<string, SkippedRule>(evaluation.skipped.map((skip) => [skip.ruleId, skip]));

    for (const rule of rules) {
        const check = (hit: boolean, didFire: boolean, note: string, price?: Sourced) => checks.push({ ruleId: rule.id, symbol: rule.symbol, hit, fired: didFire, note, price });
        const event = eventOf.get(rule.id);
        const skip = skipOf.get(rule.id);
        // A once-rule that fired, or a repeating rule that already fired this market day (a trigger that stays true must not empty the cash)
        if (skip?.reason === 'spent' || skip?.reason === 'cooldown') {
            check(false, false, say(serviceRef('svc.rule.note', { note: skip.reason === 'spent' ? 'fired_once' : 'fired_today' })));
            continue;
        }
        const condition = (event?.condition ?? skip?.condition) as PriceCondition | undefined;
        if (!condition || skip?.reason === 'no_price') {
            check(false, false, say(serviceRef('svc.rule.note', { note: 'no_price' })));
            continue;
        }
        const factRef = factRefOf(condition);
        const fact = say(factRef);
        const quote = quotes[rule.symbol];
        if (!condition.met) {
            check(false, false, fact, quote);
            continue;
        }
        // The order the evaluator decided; one it refused for lack of cash or units is still put to the simulated
        // portfolio, which re-checks at the fill and gives the refusal its exact figures
        const refused = skip?.dropped?.[0];
        const order = event?.orders[0] ?? (refused && refused.reason !== 'below_min_order' && refused.reason !== 'no_price' ? refused.order : undefined);
        if (!order) {
            check(true, false, say(serviceRef('svc.rule.not_simulated', { fact: factRef, why: refused ? renderText(dropTextRef(refused), locale) : say(serviceRef('svc.rule.not_recorded', {})) })), quote);
            continue;
        }
        try {
            const reasonRef = serviceRef('svc.rule.trade_reason', { ruleId: rule.id, fact: factRef });
            const outcome = await simulateTrade({ symbol: order.symbol, side: order.side, amountCad: order.amountCad, quantity: order.quantity, origin: 'rule', ruleId: rule.id, reason: renderText(reasonRef, 'en'), reasonRef }, locale, scope);
            if (outcome.status !== 'filled') throw new ServiceError(409, outcome.message);
            fired.push(outcome.trade);
            check(true, true, fact, outcome.trade.price);
            await updateState(scope, (state) => {
                const stored = state.rules.find((r) => r.id === rule.id);
                if (!stored) return;
                stored.lastFiredAt = outcome.trade.at;
                if (stored.once) stored.status = 'paused';
            });
        } catch (error) {
            const why = error instanceof ServiceError ? error.messageIn(locale) : serviceRef('svc.rule.not_recorded', {});
            check(true, false, say(serviceRef('svc.rule.not_simulated', { fact: factRef, why })), quote);
        }
    }
    return { fired, checkedAt, checks };
}

// One evaluation at a time: two overlapping polls must not fire the same rule twice
const holder = globalThis as { __rulesEvaluation?: Promise<unknown> };

/** Checks every active rule against the last quote and simulates a fill on each hit. Notes and reasons are in `locale` (default: the request's). */
export async function evaluateRules(locale?: Locale, scope?: Scope): Promise<{ fired: SimulatedTrade[]; checkedAt: string; checks: RuleCheck[] }> {
    // Resolved before queuing, while the request is still being served
    const lang = await languageOf(locale);
    const s = await scopeOr(scope);
    const run = () => evaluate(lang, s);
    const result = (holder.__rulesEvaluation ?? Promise.resolve()).then(run, run);
    holder.__rulesEvaluation = result.catch(() => undefined);
    return result;
}

// ---------------------------------------------------------------- strategies: stored, listed, evaluated live on request

export type StoredStrategy = Strategy & { createdAt: string; updatedAt: string; peakValueCad?: number };
/** A strategy refused by validation: every problem with its code, place and values (and the sentence in the caller's language). */
export class StrategyInvalidError extends ServiceError {
    constructor(public issues: StrategyIssue[]) {
        super(400, serviceRef('svc.joined', { items: issues.map((issue) => issue.textRef) }));
        this.name = 'StrategyInvalidError';
    }
}

const MAX_STRATEGIES = 20;
// Strategies live in the same app-state document as the rules, under a key of their own (the document keeps unknown keys)
type WithStrategies = { strategies?: StoredStrategy[] };
const strategiesIn = (state: unknown): StoredStrategy[] => ((state as WithStrategies).strategies ??= []);
const sameRule = (a: StrategyRule, b: StrategyRule) => JSON.stringify({ ...a, version: 0 }) === JSON.stringify({ ...b, version: 0 });

export const listStrategies = async (scope?: Scope): Promise<StoredStrategy[]> => [...((await readState(await scopeOr(scope))) as WithStrategies).strategies ?? []];

export async function getStrategy(id: string, scope?: Scope): Promise<StoredStrategy> {
    const found = (await listStrategies(scope)).find((strategy) => strategy.id === id);
    if (!found) throw new ServiceError(404, { key: 'strat.unknown_strategy', params: { id } });
    return found;
}

/**
 * Creates a strategy, or updates the stored one with the same id: its version goes up by one, and so does the
 * version of each rule whose content changed. Throws StrategyInvalidError (400) with the coded problems.
 */
export async function saveStrategy(input: unknown, scope?: Scope): Promise<StoredStrategy> {
    const s = await scopeOr(scope);
    const parsed = parseStrategy(input);
    if (!parsed.ok) throw new StrategyInvalidError(parsed.errors);
    const now = new Date().toISOString();
    const given = (input as { id?: unknown }).id !== undefined;
    let saved: StoredStrategy | undefined;
    await updateState(s, (state) => {
        const list = strategiesIn(state);
        const at = given ? list.findIndex((strategy) => strategy.id === parsed.strategy.id) : -1;
        const before = at >= 0 ? list[at] : undefined;
        const rules = parsed.strategy.rules.map((rule) => {
            const old = before?.rules.find((r) => r.id === rule.id);
            return { ...rule, version: old ? (sameRule(old, rule) ? old.version : old.version + 1) : 1 };
        });
        saved = {
            id: before?.id ?? (given ? parsed.strategy.id : `strat_${randomBytes(4).toString('hex')}`),
            name: parsed.strategy.name,
            rules,
            version: before ? before.version + 1 : 1,
            createdAt: before?.createdAt ?? now,
            updatedAt: now,
            ...(before?.peakValueCad !== undefined ? { peakValueCad: before.peakValueCad } : {}),
        };
        if (at >= 0) list[at] = saved;
        else list.push(saved);
        if (list.length > MAX_STRATEGIES) list.splice(0, list.length - MAX_STRATEGIES);
    });
    await appendDecision({ userId: s.portfolioUserId, kind: 'user_action', ruleVersions: { rules: RULES_VERSION, strategy: STRATEGY_CONFIG.version }, payload: { action: saved!.version === 1 ? 'strategy_create' : 'strategy_update', strategy: saved, simulated: true } });
    return saved!;
}

/**
 * Removes one of the visitor's strategies from the app-state document (which is mutable) and records the removal as a
 * 'user_action' row of the append-only decision log, with the strategy as it was. Throws 404 for an unknown id.
 */
export async function removeStrategy(id: string, scope?: Scope): Promise<StoredStrategy> {
    const s = await scopeOr(scope);
    let removed: StoredStrategy | undefined;
    await updateState(s, (state) => {
        const list = strategiesIn(state);
        const at = list.findIndex((strategy) => strategy.id === id);
        if (at >= 0) removed = list.splice(at, 1)[0];
    });
    if (!removed) throw new ServiceError(404, { key: 'strat.unknown_strategy', params: { id } });
    await appendDecision({ userId: s.portfolioUserId, kind: 'user_action', ruleVersions: { rules: RULES_VERSION, strategy: STRATEGY_CONFIG.version }, payload: { action: 'strategy_remove', strategy: removed, simulated: true } });
    return removed;
}

export type LiveStrategyCheck = {
    strategyId: string;
    strategyVersion: number;
    checkedAt: string;
    simulated: true;
    /** Nothing is executed: these are the orders the rules would ask for on the simulated portfolio right now. */
    executed: false;
    valueCad: number;
    peakValueCad: number;
    cashCad: number;
    events: Array<RuleEvent & { sentenceRef: TextRef; sentence: Sentence }>;
    skipped: SkippedRule[];
    unpriced: string[];
};

/**
 * Evaluates a stored strategy on the simulated portfolio as it stands now, with the shared evaluator. On request
 * only (no scheduler) and with no execution. The firing memory is not kept between calls (nothing fired); the peak
 * value seen is, so a drawdown guard can be read against it. Target weights default to the current weights.
 */
export async function evaluateStrategyLive(strategyId: string, scope?: Scope): Promise<LiveStrategyCheck> {
    const s = await scopeOr(scope);
    const strategy = await getStrategy(strategyId, s);
    const held = (await getPortfolioState(s)).positions.map((position) => position.symbol);
    const wanted = [...new Set([...held, ...strategySymbols(strategy)])];
    const { state, checkedAt } = await liveState(s, wanted, { lastFiredDay: {}, guardActive: {}, spent: {} }, strategy.peakValueCad);
    const valueCad = portfolioValueCad(state, state.prices);
    const baseWeights = Object.fromEntries(held.filter((symbol) => state.prices[symbol]).map((symbol) => [symbol, valueCad > 0 ? (state.positions[symbol] * state.prices[symbol].priceCad / valueCad) * 100 : 0]));
    const evaluation = evaluateShared(state, strategy.rules, { config: STRATEGY_CONFIG, baseWeights });
    if (state.peakValueCad > (strategy.peakValueCad ?? 0)) {
        await updateState(s, (doc) => {
            const stored = strategiesIn(doc).find((item) => item.id === strategy.id);
            if (stored) stored.peakValueCad = state.peakValueCad;
        });
    }
    return {
        strategyId: strategy.id,
        strategyVersion: strategy.version,
        checkedAt,
        simulated: true,
        executed: false,
        valueCad,
        peakValueCad: state.peakValueCad,
        cashCad: state.cashCad,
        events: evaluation.events.map((event) => {
            const sentenceRef = eventTextRef(event, strategy.rules.find((rule) => rule.id === event.ruleId));
            return { ...event, sentenceRef, sentence: bothLanguages(sentenceRef) };
        }),
        skipped: evaluation.skipped,
        unpriced: wanted.filter((symbol) => !state.prices[symbol]).sort(),
    };
}
