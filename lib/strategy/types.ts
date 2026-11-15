// A strategy is a named set of rules. Pure: types, strict zod schemas (an unknown field is refused, every number has
// a range) and a validator that answers with codes and values, never with prose, so the UI can show each problem in
// French or English through the catalog (lib/strategy/text.ts).

import { z } from 'zod';
import type { InvestmentRule, TextRef } from '@/lib/domain/types';

export const RULE_KINDS = ['price_threshold', 'allocation_target', 'weight_cap', 'drawdown_guard', 'periodic_purchase'] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

export const TRIGGER_TYPES = ['price_below', 'price_above', 'change_pct_below', 'change_pct_above'] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

/** Limits of every numeric field; the schemas and the UI read them from here. */
export const LIMITS = {
    nameMax: 80,
    rulesMax: 12,
    targetsMax: 40,
    weightPct: { min: 0.1, max: 100 },
    driftPts: { min: 0.5, max: 50 },
    capPct: { min: 1, max: 100 },
    triggerDrawdownPct: { min: 1, max: 90 },
    movePct: { min: 1, max: 100 },
    recoverDrawdownPct: { min: 0, max: 89 },
    purchaseCad: { min: 25, max: 1_000_000 },
    everyTradingDays: { min: 5, max: 252 },
} as const;

const symbol = z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9.\-=^]{0,19}$/);
const ruleBase = { id: z.string().trim().min(1).max(40).optional(), version: z.number().int().min(1).max(9999).optional() };
const weightPct = z.number().min(LIMITS.weightPct.min).max(LIMITS.weightPct.max);

const targetSchema = z.union([
    z.strictObject({ symbol, weightPct }),
    z.strictObject({ group: z.string().trim().min(1).max(40), symbols: z.array(symbol).min(1).max(20), weightPct }),
]);

/** The V1 rule: same trigger, action and once fields as InvestmentRule. */
const priceThresholdSchema = z.strictObject({
    ...ruleBase,
    kind: z.literal('price_threshold'),
    symbol,
    trigger: z.strictObject({ type: z.enum(TRIGGER_TYPES), value: z.number().finite() }),
    action: z.strictObject({ side: z.enum(['buy', 'sell']), amountCad: z.number().positive().max(10_000_000).optional(), quantity: z.number().positive().max(10_000_000).optional() }),
    once: z.boolean().default(true),
    text: z.string().trim().max(300).optional(),
});

const allocationTargetSchema = z.strictObject({
    ...ruleBase,
    kind: z.literal('allocation_target'),
    targets: z.array(targetSchema).min(1).max(LIMITS.targetsMax),
    rebalance: z.discriminatedUnion('mode', [
        z.strictObject({ mode: z.literal('quarterly') }),
        z.strictObject({ mode: z.literal('drift'), driftPts: z.number().min(LIMITS.driftPts.min).max(LIMITS.driftPts.max) }),
    ]),
});

const weightCapSchema = z.strictObject({
    ...ruleBase,
    kind: z.literal('weight_cap'),
    maxWeightPct: z.number().min(LIMITS.capPct.min).max(LIMITS.capPct.max),
    /** Where the trimmed excess goes: absent = cash. */
    proceedsSymbol: symbol.optional(),
});

const drawdownGuardSchema = z.strictObject({
    ...ruleBase,
    kind: z.literal('drawdown_guard'),
    triggerDrawdownPct: z.number().min(LIMITS.triggerDrawdownPct.min).max(LIMITS.triggerDrawdownPct.max),
    movePct: z.number().min(LIMITS.movePct.min).max(LIMITS.movePct.max),
    defensiveSymbol: symbol,
    recoverDrawdownPct: z.number().min(LIMITS.recoverDrawdownPct.min).max(LIMITS.recoverDrawdownPct.max),
});

const periodicPurchaseSchema = z.strictObject({
    ...ruleBase,
    kind: z.literal('periodic_purchase'),
    amountCad: z.number().min(LIMITS.purchaseCad.min).max(LIMITS.purchaseCad.max),
    every: z.discriminatedUnion('unit', [
        z.strictObject({ unit: z.literal('month') }),
        z.strictObject({ unit: z.literal('trading_days'), n: z.number().int().min(LIMITS.everyTradingDays.min).max(LIMITS.everyTradingDays.max) }),
    ]),
});

export const strategyRuleSchema = z.discriminatedUnion('kind', [priceThresholdSchema, allocationTargetSchema, weightCapSchema, drawdownGuardSchema, periodicPurchaseSchema]);

export const strategySchema = z.strictObject({
    id: z.string().trim().min(1).max(40).optional(),
    name: z.string().trim().min(1).max(LIMITS.nameMax),
    rules: z.array(strategyRuleSchema).max(LIMITS.rulesMax),
    version: z.number().int().min(1).max(999_999).optional(),
});

type WithIdentity<T> = Omit<T, 'id' | 'version'> & { id: string; version: number };
export type PriceThresholdRule = WithIdentity<z.output<typeof priceThresholdSchema>>;
export type AllocationTargetRule = WithIdentity<z.output<typeof allocationTargetSchema>>;
export type WeightCapRule = WithIdentity<z.output<typeof weightCapSchema>>;
export type DrawdownGuardRule = WithIdentity<z.output<typeof drawdownGuardSchema>>;
export type PeriodicPurchaseRule = WithIdentity<z.output<typeof periodicPurchaseSchema>>;
export type StrategyRule = PriceThresholdRule | AllocationTargetRule | WeightCapRule | DrawdownGuardRule | PeriodicPurchaseRule;
export type AllocationTarget = z.output<typeof targetSchema>;

export type Strategy = { id: string; name: string; rules: StrategyRule[]; version: number };
/** What the UI or the agent sends: ids and versions are optional and filled in by parseStrategy. */
export type StrategyInput = z.input<typeof strategySchema>;

// ---------------------------------------------------------------- validation with codes

export type StrategyIssueCode =
    | 'unknown_field' | 'required' | 'wrong_type' | 'not_accepted' | 'too_small' | 'too_big' | 'too_few' | 'too_many' | 'too_short' | 'too_long' | 'invalid'
    | 'targets_over_100' | 'duplicate_target' | 'recover_not_below_trigger' | 'amount_or_quantity' | 'price_trigger_not_positive' | 'change_trigger_out_of_range' | 'duplicate_rule_id';

export type StrategyIssue = {
    code: StrategyIssueCode;
    /** Where in the input: 'rules.1.maxWeightPct'. */
    path: string;
    values: Record<string, string | number | null>;
    /** Catalog key `strat.invalid.<code>` with the path and the values; render with renderText(textRef, locale). */
    textRef: TextRef;
};

export type StrategyValidation = { ok: true; strategy: Strategy } | { ok: false; errors: StrategyIssue[] };

const issue = (code: StrategyIssueCode, path: string, values: StrategyIssue['values'] = {}): StrategyIssue => ({
    code,
    path,
    values,
    textRef: { key: `strat.invalid.${code}`, params: { path, ...values } },
});

type RawIssue = z.core.$ZodIssue & { origin?: string; minimum?: number | bigint; maximum?: number | bigint; keys?: string[]; expected?: string; input?: unknown };

function fromZod(raw: RawIssue): StrategyIssue[] {
    const path = raw.path.join('.') || 'strategy';
    switch (raw.code) {
        case 'unrecognized_keys':
            return (raw.keys ?? []).map((key) => issue('unknown_field', raw.path.length ? `${path}.${key}` : key, { field: key }));
        case 'invalid_type':
            return [issue(/received undefined/.test(raw.message) ? 'required' : 'wrong_type', path, { expected: raw.expected ?? null })];
        case 'too_small':
        case 'too_big': {
            const small = raw.code === 'too_small';
            const limit = Number(small ? raw.minimum : raw.maximum);
            const code: StrategyIssueCode = raw.origin === 'string' ? (small ? 'too_short' : 'too_long') : raw.origin === 'array' ? (small ? 'too_few' : 'too_many') : small ? 'too_small' : 'too_big';
            return [issue(code, path, { limit })];
        }
        case 'invalid_value':
        case 'invalid_union':
            return [issue('not_accepted', path)];
        default:
            return [issue('invalid', path)];
    }
}

/** The symbols a target list names, groups expanded. */
export const targetSymbols = (targets: AllocationTarget[]): string[] => targets.flatMap((target) => ('symbol' in target ? [target.symbol] : target.symbols));

/** Every symbol a strategy can trade, sorted. */
export function strategySymbols(strategy: Pick<Strategy, 'rules'>): string[] {
    const found = new Set<string>();
    for (const rule of strategy.rules) {
        if (rule.kind === 'price_threshold') found.add(rule.symbol);
        else if (rule.kind === 'allocation_target') targetSymbols(rule.targets).forEach((s) => found.add(s));
        else if (rule.kind === 'weight_cap' && rule.proceedsSymbol) found.add(rule.proceedsSymbol);
        else if (rule.kind === 'drawdown_guard') found.add(rule.defensiveSymbol);
    }
    return [...found].sort();
}

/**
 * Validates a strategy. Missing ids are filled deterministically (`<kind>_<position>`, strategy id 'draft') and
 * missing versions with 1, so the same input always gives the same strategy (and the same replay id).
 */
export function parseStrategy(input: unknown): StrategyValidation {
    const parsed = strategySchema.safeParse(input);
    if (!parsed.success) return { ok: false, errors: parsed.error.issues.flatMap((raw) => fromZod(raw as RawIssue)) };

    const errors: StrategyIssue[] = [];
    const ids = new Set<string>();
    const rules = parsed.data.rules.map((rule, index): StrategyRule => {
        const at = `rules.${index}`;
        const id = rule.id ?? `${rule.kind}_${index + 1}`;
        if (ids.has(id)) errors.push(issue('duplicate_rule_id', `${at}.id`, { id }));
        ids.add(id);

        if (rule.kind === 'allocation_target') {
            const total = rule.targets.reduce((sum, target) => sum + target.weightPct, 0);
            if (total > 100 + 1e-9) errors.push(issue('targets_over_100', `${at}.targets`, { total: Math.round(total * 100) / 100, limit: 100 }));
            const seen = new Set<string>();
            for (const s of targetSymbols(rule.targets)) {
                if (seen.has(s)) errors.push(issue('duplicate_target', `${at}.targets`, { symbol: s }));
                seen.add(s);
            }
        }
        if (rule.kind === 'drawdown_guard' && !(rule.recoverDrawdownPct < rule.triggerDrawdownPct)) {
            errors.push(issue('recover_not_below_trigger', `${at}.recoverDrawdownPct`, { value: rule.recoverDrawdownPct, limit: rule.triggerDrawdownPct }));
        }
        if (rule.kind === 'price_threshold') {
            const { trigger, action } = rule;
            if ((action.amountCad === undefined) === (action.quantity === undefined)) errors.push(issue('amount_or_quantity', `${at}.action`));
            const onPrice = trigger.type === 'price_below' || trigger.type === 'price_above';
            if (onPrice && !(trigger.value > 0)) errors.push(issue('price_trigger_not_positive', `${at}.trigger.value`, { value: trigger.value }));
            if (!onPrice && (trigger.value === 0 || Math.abs(trigger.value) > 100)) errors.push(issue('change_trigger_out_of_range', `${at}.trigger.value`, { value: trigger.value, limit: 100 }));
        }
        return { ...rule, id, version: rule.version ?? 1 } as StrategyRule;
    });
    if (errors.length > 0) return { ok: false, errors };
    return { ok: true, strategy: { id: parsed.data.id ?? 'draft', name: parsed.data.name, rules, version: parsed.data.version ?? 1 } };
}

/** A stored V1 rule as a strategy rule (same symbol, trigger, action and once). */
export function fromInvestmentRule(rule: InvestmentRule): PriceThresholdRule {
    return { kind: 'price_threshold', id: rule.id, version: 1, symbol: rule.symbol, trigger: { ...rule.trigger }, action: { ...rule.action }, once: rule.once, text: rule.text };
}
