// Pure helpers of the strategy builder: default rules, the engine's priority order, targets from the current
// portfolio, server issues mapped to the rule they concern. No fetching here.

import { STRATEGY_CONFIG } from '@/lib/strategy/config';
import { LIMITS, RULE_KINDS, type AllocationTarget, type RuleKind, type StrategyRule } from '@/lib/strategy/types';

/** What the builder edits: a strategy whose rules always carry an id (made in the browser for new ones). */
export type StrategyDraft = { id?: string; name: string; rules: StrategyRule[]; version?: number };

/** A stored strategy as GET /api/strategy returns it. */
export type StoredStrategy = { id: string; name: string; rules: StrategyRule[]; version: number; createdAt: string; updatedAt: string };

/** One problem of a refused save: POST /api/strategy answers 400 with these, message in the request's language. */
export type ServerIssue = { code: string; path: string; values: Record<string, unknown>; message: string };

/** The holdings the builder needs from GET /api/portfolio. */
export type Holding = { symbol: string; valueCad: number; price: number | null };

/** Rule kinds in the order the engine evaluates them on one day (rules/v1.json, via STRATEGY_CONFIG). */
export const PRIORITY: RuleKind[] = [...STRATEGY_CONFIG.priority, ...RULE_KINDS.filter((kind) => !STRATEGY_CONFIG.priority.includes(kind))];

/** Rules sorted by the engine's priority; rules of the same kind keep their order. */
export const byPriority = (rules: StrategyRule[]): StrategyRule[] =>
    rules.map((rule, index) => ({ rule, index })).sort((a, b) => PRIORITY.indexOf(a.rule.kind) - PRIORITY.indexOf(b.rule.kind) || a.index - b.index).map(({ rule }) => rule);

export const newRuleId = (kind: RuleKind): string => `${kind}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

const floor1 = (value: number) => Math.floor(value * 10) / 10;

/** Current weights of the simulated portfolio, cash counted in the total (as the engine does), rounded down to 0.1 so they never add up over 100. */
export function targetsFromHoldings(holdings: Holding[], cashCad: number): AllocationTarget[] {
    const total = cashCad + holdings.reduce((sum, holding) => sum + holding.valueCad, 0);
    if (total <= 0) return [];
    return holdings
        .map((holding) => ({ symbol: holding.symbol, weightPct: floor1((holding.valueCad / total) * 100) }))
        .filter((target) => target.weightPct >= LIMITS.weightPct.min)
        .sort((a, b) => b.weightPct - a.weightPct)
        .slice(0, LIMITS.targetsMax);
}

const DEFENSIVE = 'XBB.TO';

/** A new rule of `kind` with values inside LIMITS, taken from the portfolio when that makes sense. */
export function defaultRule(kind: RuleKind, holdings: Holding[], targets: AllocationTarget[]): StrategyRule {
    const base = { id: newRuleId(kind), version: 1 };
    switch (kind) {
        case 'allocation_target':
            return { ...base, kind, targets: targets.length ? targets : [{ symbol: 'XIU.TO', weightPct: 60 }, { symbol: 'XBB.TO', weightPct: 40 }], rebalance: { mode: 'drift', driftPts: 5 } };
        case 'weight_cap':
            return { ...base, kind, maxWeightPct: 25 };
        case 'drawdown_guard':
            return { ...base, kind, triggerDrawdownPct: 15, movePct: 50, defensiveSymbol: DEFENSIVE, recoverDrawdownPct: 5 };
        case 'periodic_purchase':
            return { ...base, kind, amountCad: 500, every: { unit: 'month' } };
        case 'price_threshold': {
            const first = [...holdings].sort((a, b) => b.valueCad - a.valueCad)[0];
            const price = first?.price ? Math.round(first.price * 0.9 * 100) / 100 : 100;
            return { ...base, kind, symbol: first?.symbol ?? 'XIU.TO', trigger: { type: 'price_below', value: price }, action: { side: 'buy', amountCad: 500 }, once: true };
        }
    }
}

/** The body POST /api/strategy and POST /api/replay accept (no storage dates). */
export const toInput = (draft: StrategyDraft) => ({
    ...(draft.id ? { id: draft.id } : {}),
    name: draft.name.trim(),
    rules: draft.rules,
    ...(draft.version ? { version: draft.version } : {}),
});

/** Which rule an issue path points at ('rules.2.maxWeightPct' -> 2), or null for the strategy itself. */
export function ruleIndexOf(path: string): number | null {
    const match = /^rules\.(\d+)(?:\.|$)/.exec(path);
    return match ? Number(match[1]) : null;
}

export const sameDraft = (a: StrategyDraft, b: StrategyDraft) => JSON.stringify(toInput(a)) === JSON.stringify(toInput(b));
