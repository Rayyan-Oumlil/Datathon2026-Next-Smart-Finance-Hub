// The demo rules engine (spec section 11): rules live in the app-state file, the engine reads the last quote and,
// on a hit, simulates a fill at that price. No broker, no real trade.

import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { getAppLocale } from '@/i18n/locale';
import { DEMO_USER } from '@/lib/demo-user';
import { RULES, RULES_VERSION } from '@/lib/rules';
import type { InvestmentRule, SimulatedTrade, Sourced, TextRef } from '@/lib/domain/types';
import { marketDate } from '@/lib/sources/daily-signals';
import { appendDecision, readState, updateState } from '@/lib/store';
import { getEntry } from '@/lib/universe';
import type { Locale } from '@/lib/watchlist/text';
import { ServiceError } from './errors';
import { getPortfolioState, simulateTrade } from './portfolio';
import { fxUsdCad, isTradable, liveQuote, toCad } from './quotes';
import { issueRef, renderText, serviceRef } from './text';

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

/** validateRule with each problem as a catalog reference, so a caller can show them in either language. */
async function checkRule(input: unknown): Promise<{ ok: true; rule: InvestmentRule; currentPrice?: Sourced } | { ok: false; refs: TextRef[]; currentPrice?: Sourced }> {
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
        const portfolio = await getPortfolioState();
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
export async function validateRule(input: unknown, locale?: Locale): Promise<RuleValidation> {
    const lang = await languageOf(locale);
    const checked = await checkRule(input);
    if (checked.ok) return checked;
    return { ok: false, errors: checked.refs.map((ref) => renderText(ref, lang)), currentPrice: checked.currentPrice };
}

const logRuleAction = (rule: InvestmentRule, action: string) =>
    appendDecision({ userId: DEMO_USER.id, kind: 'user_action', symbol: rule.symbol, ruleVersions: { rules: RULES_VERSION, filters: RULES.filters.version }, payload: { action, rule, simulated: true } });

export async function createRule(input: unknown): Promise<InvestmentRule> {
    const checked = await checkRule(input);
    if (!checked.ok) throw new ServiceError(400, serviceRef('svc.joined', { items: checked.refs }));
    await updateState((state) => {
        state.rules.push(checked.rule);
    });
    await logRuleAction(checked.rule, 'rule_create');
    return checked.rule;
}

export async function setRuleStatus(id: string, status: InvestmentRule['status']): Promise<InvestmentRule> {
    let changed: InvestmentRule | undefined;
    let spent = false;
    await updateState((state) => {
        changed = state.rules.find((rule) => rule.id === id);
        // A once-rule that has fired never fires again: resuming it would show an active rule that does nothing
        spent = Boolean(changed && status === 'active' && changed.once && changed.lastFiredAt);
        if (changed && !spent) changed.status = status;
    });
    if (!changed) throw new ServiceError(404, serviceRef('svc.rule.unknown_id', { id }));
    if (spent) throw new ServiceError(409, serviceRef('svc.rule.spent', {}));
    await logRuleAction(changed, status === 'paused' ? 'rule_pause' : 'rule_resume');
    return changed;
}

export const listRules = async (): Promise<InvestmentRule[]> => (await readState()).rules;

/**
 * Tests a trigger against a quote. Returns whether it hit and the factual sentence used as the trade's reason (or
 * the check's note), in `locale` (default English), with its catalog reference.
 */
export function testTrigger(rule: InvestmentRule, price: Sourced, changePercent?: Sourced, locale: Locale = 'en'): { hit: boolean; fact: string; factRef: TextRef } {
    const { type, value } = rule.trigger;
    const done = (hit: boolean, factRef: TextRef) => ({ hit, fact: renderText(factRef, locale), factRef });
    if (isPriceTrigger(type)) {
        const hit = type === 'price_below' ? price.value < value : price.value > value;
        const relation = type === 'price_below' ? 'below' : 'above';
        return done(hit, serviceRef('svc.rule.fact_price', { price: price.value, value, currency: price.currency ?? '', hit, relation }));
    }
    if (!changePercent) return done(false, serviceRef('svc.rule.fact_no_change', {}));
    const hit = type === 'change_pct_below' ? changePercent.value < value : changePercent.value > value;
    const relation = type === 'change_pct_below' ? 'below' : 'above';
    return done(hit, serviceRef('svc.rule.fact_change', { change: changePercent.value, value, hit, relation }));
}

async function evaluate(locale: Locale): Promise<{ fired: SimulatedTrade[]; checkedAt: string; checks: RuleCheck[] }> {
    const say = (ref: TextRef) => renderText(ref, locale);
    const checkedAt = new Date().toISOString();
    const today = marketDate(new Date(checkedAt));
    const fired: SimulatedTrade[] = [];
    const checks: RuleCheck[] = [];

    for (const rule of (await readState()).rules.filter((r) => r.status === 'active')) {
        const check = (hit: boolean, didFire: boolean, note: string, price?: Sourced) => checks.push({ ruleId: rule.id, symbol: rule.symbol, hit, fired: didFire, note, price });
        // A repeating rule fires at most once per market day, so a trigger that stays true does not empty the cash
        if (rule.lastFiredAt && (rule.once || marketDate(new Date(rule.lastFiredAt)) === today)) {
            check(false, false, say(serviceRef('svc.rule.note', { note: rule.once ? 'fired_once' : 'fired_today' })));
            continue;
        }
        const entry = getEntry(rule.symbol);
        const quote = entry ? await liveQuote(entry).catch(() => null) : null;
        if (!quote) {
            check(false, false, say(serviceRef('svc.rule.note', { note: 'no_price' })));
            continue;
        }
        const { hit, fact, factRef } = testTrigger(rule, quote.price, quote.changePercent, locale);
        if (!hit) {
            check(false, false, fact, quote.price);
            continue;
        }
        try {
            const reasonRef = serviceRef('svc.rule.trade_reason', { ruleId: rule.id, fact: factRef });
            const outcome = await simulateTrade({ symbol: rule.symbol, side: rule.action.side, amountCad: rule.action.amountCad, quantity: rule.action.quantity, origin: 'rule', ruleId: rule.id, reason: renderText(reasonRef, 'en'), reasonRef }, locale);
            if (outcome.status !== 'filled') throw new ServiceError(409, outcome.message);
            fired.push(outcome.trade);
            check(true, true, fact, outcome.trade.price);
            await updateState((state) => {
                const stored = state.rules.find((r) => r.id === rule.id);
                if (!stored) return;
                stored.lastFiredAt = outcome.trade.at;
                if (stored.once) stored.status = 'paused';
            });
        } catch (error) {
            const why = error instanceof ServiceError ? error.messageIn(locale) : serviceRef('svc.rule.not_recorded', {});
            check(true, false, say(serviceRef('svc.rule.not_simulated', { fact: factRef, why })), quote.price);
        }
    }
    return { fired, checkedAt, checks };
}

// One evaluation at a time: two overlapping polls must not fire the same rule twice
const holder = globalThis as { __rulesEvaluation?: Promise<unknown> };

/** Checks every active rule against the last quote and simulates a fill on each hit. Notes and reasons are in `locale` (default: the request's). */
export function evaluateRules(locale?: Locale): Promise<{ fired: SimulatedTrade[]; checkedAt: string; checks: RuleCheck[] }> {
    const run = async () => evaluate(await languageOf(locale));
    const result = (holder.__rulesEvaluation ?? Promise.resolve()).then(run, run);
    holder.__rulesEvaluation = result.catch(() => undefined);
    return result;
}
