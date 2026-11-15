// Rule names, rule descriptions and the numbers of a rule's condition, written from the result's own fields through
// the Replay catalog (no sentence is built by hand outside messages/*/Replay.json).

import type { ReplayResult, ReplayRuleEvent } from '@/lib/replay/engine/types';
import type { StrategyRule } from '@/lib/strategy/types';
import type { ReplayFmt } from './useReplayFmt';

/** The Replay namespace's translator, as the helpers below use it. */
export type T = (key: string, values?: Record<string, string | number>) => string;

/** One colour per rule, in strategy order; chart strokes come from CSS variables only. */
const RULE_COLORS = ['var(--brand)', 'var(--warn)', 'var(--up)', 'var(--muted)', 'var(--down)'];
export const ruleColor = (index: number) => RULE_COLORS[index % RULE_COLORS.length];

export function ruleIndex(result: ReplayResult): Map<string, number> {
    return new Map(result.params.strategy.rules.map((rule, i) => [rule.id, i]));
}

export function ruleById(result: ReplayResult, ruleId: string): StrategyRule | undefined {
    return result.params.strategy.rules.find((rule) => rule.id === ruleId);
}

/** "Garde-fou de baisse (1)": the kind's name and the rule's place in the strategy. */
export function ruleName(t: T, result: ReplayResult, ruleId: string): string {
    const index = result.params.strategy.rules.findIndex((rule) => rule.id === ruleId);
    const rule = result.params.strategy.rules[index];
    if (!rule) return ruleId;
    return t('rule.name', { kind: t(`kinds.${rule.kind}`), n: index + 1 });
}

/** What the rule does, with its own numbers. */
export function ruleDescription(t: T, f: ReplayFmt, rule: StrategyRule): string {
    switch (rule.kind) {
        case 'drawdown_guard':
            return t('rule.describe.drawdown_guard', { trigger: f.num(rule.triggerDrawdownPct, 1), move: f.num(rule.movePct, 1), symbol: rule.defensiveSymbol, recover: f.num(rule.recoverDrawdownPct, 1) });
        case 'allocation_target':
            return rule.rebalance.mode === 'quarterly'
                ? t('rule.describe.allocation_quarterly', { count: rule.targets.length })
                : t('rule.describe.allocation_drift', { count: rule.targets.length, drift: f.num(rule.rebalance.driftPts, 1) });
        case 'weight_cap':
            return rule.proceedsSymbol
                ? t('rule.describe.weight_cap_to', { cap: f.num(rule.maxWeightPct, 1), symbol: rule.proceedsSymbol })
                : t('rule.describe.weight_cap', { cap: f.num(rule.maxWeightPct, 1) });
        case 'periodic_purchase':
            return rule.every.unit === 'month'
                ? t('rule.describe.periodic_month', { amount: f.money(rule.amountCad) })
                : t('rule.describe.periodic_days', { amount: f.money(rule.amountCad), n: rule.every.n });
        case 'price_threshold':
            return t('rule.describe.price_threshold', { symbol: rule.symbol, trigger: t(`triggers.${rule.trigger.type}`), value: f.num(rule.trigger.value, 2) });
    }
}

/** The numbers the condition was tested on at the close of the decision day. */
export function conditionText(t: T, f: ReplayFmt, event: ReplayRuleEvent): string {
    const c = event.condition;
    switch (c.kind) {
        case 'drawdown_guard':
            return t(c.phase === 'enter' ? 'condition.guard_enter' : 'condition.guard_exit', {
                fall: f.num(c.fallPct, 1), threshold: f.num(c.thresholdPct, 1), value: f.money(c.valueCad), peak: f.money(c.peakValueCad),
            });
        case 'allocation_target':
            return c.mode === 'quarterly'
                ? t('condition.rebalance_quarterly', { quarter: c.quarter, drift: f.num(c.maxDriftPts, 1), symbol: c.driftOf })
                : t('condition.rebalance_drift', { drift: f.num(c.maxDriftPts, 1), symbol: c.driftOf, threshold: f.num(c.thresholdPts ?? 0, 1) });
        case 'weight_cap': {
            const top = [...c.over].sort((a, b) => b.weightPct - a.weightPct)[0] ?? c.highest;
            return t('condition.weight_cap', { symbol: top?.symbol ?? '', weight: f.num(top?.weightPct ?? 0, 1), cap: f.num(c.capPct, 1), others: Math.max(0, c.over.length - 1) });
        }
        case 'periodic_purchase':
            return c.daysSinceLast === null
                ? t('condition.periodic_first', { amount: f.money(c.amountCad) })
                : t('condition.periodic', { amount: f.money(c.amountCad), days: c.daysSinceLast });
        case 'price_threshold':
            return t('condition.price_threshold', { symbol: c.symbol, price: f.num(c.price, 2), currency: c.currency, threshold: f.num(c.threshold, 2), trigger: t(`triggers.${c.trigger}`) });
    }
}
