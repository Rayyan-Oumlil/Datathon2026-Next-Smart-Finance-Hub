// The demo rules engine (spec section 11): rules live in the app-state file, the engine reads the last quote and,
// on a hit, simulates a fill at that price. No broker, no real trade.

import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { DEMO_USER } from '@/lib/demo-user';
import { RULES, RULES_VERSION } from '@/lib/rules';
import type { InvestmentRule, SimulatedTrade, Sourced } from '@/lib/domain/types';
import { marketDate } from '@/lib/sources/daily-signals';
import { appendDecision, readState, updateState } from '@/lib/store';
import { getEntry } from '@/lib/universe';
import { ServiceError, issueText } from './errors';
import { getPortfolioState, simulateTrade } from './portfolio';
import { fxUsdCad, isTradable, liveQuote, toCad } from './quotes';

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
const fixed2 = (value: number) => value.toFixed(2);

/** Checks a rule against the universe, the last price and the simulated portfolio. Nothing is saved. */
export async function validateRule(input: unknown): Promise<RuleValidation> {
    const parsed = ruleInputSchema.safeParse(input);
    if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((issue) => issueText(issue, 'rule')) };
    const { text, trigger, action, once } = parsed.data;
    const errors: string[] = [];

    const entry = getEntry(parsed.data.symbol);
    if (!entry) errors.push(`${parsed.data.symbol} is not in the app's list of assets.`);
    else if (!isTradable(entry)) errors.push(`${entry.name} is a reference value here and cannot be traded in the simulation.`);

    if (isPriceTrigger(trigger.type) && !(trigger.value > 0)) errors.push('A price trigger needs a price above zero.');
    if (!isPriceTrigger(trigger.type) && (trigger.value === 0 || Math.abs(trigger.value) > 100)) errors.push('A % change trigger needs a value between -100 and 100, other than 0.');
    if ((action.amountCad === undefined) === (action.quantity === undefined)) errors.push('Give either an amount in CAD or a quantity.');

    const quote = entry && isTradable(entry) ? await liveQuote(entry).catch(() => null) : null;
    if (entry && isTradable(entry) && !quote) errors.push(`No price is available for ${entry.symbol} right now, so the rule cannot be checked.`);

    if (entry && errors.length === 0) {
        const portfolio = await getPortfolioState();
        if (action.side === 'buy') {
            const fx = quote!.price.currency === 'CAD' ? undefined : await fxUsdCad().catch(() => undefined);
            const unitCad = toCad(quote!.price.value, quote!.price.currency, fx);
            const cost = action.amountCad ?? (unitCad === null ? null : action.quantity! * unitCad);
            if (cost === null) errors.push(`The price of ${entry.symbol} cannot be converted to CAD right now.`);
            else if (cost > portfolio.cashCad) errors.push(`Simulated cash is ${fixed2(portfolio.cashCad)} CAD; this rule would need ${fixed2(cost)} CAD at the last price.`);
        } else {
            const held = portfolio.positions.find((position) => position.symbol === entry.symbol);
            if (!held) errors.push(`The simulated portfolio holds no ${entry.symbol} to reduce.`);
            else if (action.quantity !== undefined && action.quantity > held.quantity) errors.push(`The simulated position in ${entry.symbol} is ${held.quantity} units; the rule asks for ${action.quantity}.`);
        }
    }
    if (errors.length > 0 || !entry) return { ok: false, errors, currentPrice: quote?.price };

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

const logRuleAction = (rule: InvestmentRule, action: string) =>
    appendDecision({ userId: DEMO_USER.id, kind: 'user_action', symbol: rule.symbol, ruleVersions: { rules: RULES_VERSION, filters: RULES.filters.version }, payload: { action, rule, simulated: true } });

export async function createRule(input: unknown): Promise<InvestmentRule> {
    const checked = await validateRule(input);
    if (!checked.ok) throw new ServiceError(400, checked.errors.join(' '));
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
    if (!changed) throw new ServiceError(404, `No rule has the id ${id}.`);
    if (spent) throw new ServiceError(409, 'This rule was set to fire once and has already fired, so it stays paused. Create a new rule to repeat it.');
    await logRuleAction(changed, status === 'paused' ? 'rule_pause' : 'rule_resume');
    return changed;
}

export const listRules = async (): Promise<InvestmentRule[]> => (await readState()).rules;

/** Tests a trigger against a quote. Returns the factual sentence used as the trade's reason, or null on no hit. */
export function testTrigger(rule: InvestmentRule, price: Sourced, changePercent?: Sourced): { hit: boolean; fact: string } {
    const { type, value } = rule.trigger;
    if (isPriceTrigger(type)) {
        const currency = price.currency ?? '';
        const hit = type === 'price_below' ? price.value < value : price.value > value;
        const relation = type === 'price_below' ? 'below' : 'above';
        return { hit, fact: `price ${fixed2(price.value)} ${currency} was ${hit ? '' : 'not '}${relation} ${fixed2(value)} ${currency}`.replace(/\s+/g, ' ') };
    }
    if (!changePercent) return { hit: false, fact: 'the % change today is not available' };
    const hit = type === 'change_pct_below' ? changePercent.value < value : changePercent.value > value;
    const relation = type === 'change_pct_below' ? 'below' : 'above';
    return { hit, fact: `change today ${fixed2(changePercent.value)}% was ${hit ? '' : 'not '}${relation} ${fixed2(value)}%` };
}

async function evaluate(): Promise<{ fired: SimulatedTrade[]; checkedAt: string; checks: RuleCheck[] }> {
    const checkedAt = new Date().toISOString();
    const today = marketDate(new Date(checkedAt));
    const fired: SimulatedTrade[] = [];
    const checks: RuleCheck[] = [];

    for (const rule of (await readState()).rules.filter((r) => r.status === 'active')) {
        const check = (hit: boolean, didFire: boolean, note: string, price?: Sourced) => checks.push({ ruleId: rule.id, symbol: rule.symbol, hit, fired: didFire, note, price });
        // A repeating rule fires at most once per market day, so a trigger that stays true does not empty the cash
        if (rule.lastFiredAt && (rule.once || marketDate(new Date(rule.lastFiredAt)) === today)) {
            check(false, false, rule.once ? 'already fired once' : 'already fired today');
            continue;
        }
        const entry = getEntry(rule.symbol);
        const quote = entry ? await liveQuote(entry).catch(() => null) : null;
        if (!quote) {
            check(false, false, 'no price available; not evaluated');
            continue;
        }
        const { hit, fact } = testTrigger(rule, quote.price, quote.changePercent);
        if (!hit) {
            check(false, false, fact, quote.price);
            continue;
        }
        try {
            const outcome = await simulateTrade({ symbol: rule.symbol, side: rule.action.side, amountCad: rule.action.amountCad, quantity: rule.action.quantity, origin: 'rule', ruleId: rule.id, reason: `rule ${rule.id}: ${fact}` });
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
            check(true, false, `${fact}; not simulated: ${error instanceof ServiceError ? error.message : 'the trade could not be recorded'}`, quote.price);
        }
    }
    return { fired, checkedAt, checks };
}

// One evaluation at a time: two overlapping polls must not fire the same rule twice
const holder = globalThis as { __rulesEvaluation?: Promise<unknown> };

/** Checks every active rule against the last quote and simulates a fill on each hit. */
export function evaluateRules(): Promise<{ fired: SimulatedTrade[]; checkedAt: string; checks: RuleCheck[] }> {
    const result = (holder.__rulesEvaluation ?? Promise.resolve()).then(evaluate, evaluate);
    holder.__rulesEvaluation = result.catch(() => undefined);
    return result;
}
