// The constants of the shared rules evaluator, read from rules/v1.json (block `strategy`, agreed on 2026-11-15).
// Nothing here is repeated in code: the priority between rule kinds, the anti-oscillation delay and the minimum
// order size live in the rules file.

import { RULES } from '@/lib/rules';
import type { RuleKind } from './types';

export type StrategyConfig = {
    version: string;
    /** Rule kinds in the order they are evaluated on one day; a kind listed first acts first. */
    priority: RuleKind[];
    /** The same rule cannot fire again within this many trading days. */
    antiOscillationTradingDays: number;
    /** Orders worth less than this (in CAD, at the decision price) are dropped, with the reason. */
    minOrderCad: number;
    /** The V1 price-threshold rule keeps its V1 delay: at most one firing per market day. */
    priceThresholdMinDays: number;
};

export const STRATEGY_CONFIG: StrategyConfig = {
    version: RULES.strategy.version,
    priority: RULES.strategy.priority as RuleKind[],
    antiOscillationTradingDays: RULES.strategy.anti_oscillation_trading_days,
    minOrderCad: RULES.strategy.min_order_cad,
    priceThresholdMinDays: RULES.strategy.price_threshold_min_days_between_firings,
};
