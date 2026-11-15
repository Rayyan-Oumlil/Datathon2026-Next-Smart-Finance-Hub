// The deterministic sentence of each rule event and each order: a catalog reference (TextRef) built from the event's
// own numbers, rendered in French and English by lib/strategy/text.ts. No model writes these.

import type { TextRef } from '@/lib/domain/types';
import { renderText } from '@/lib/watchlist/text';
import type { DroppedOrder, RuleEvent } from './evaluate';
import { strategyRef } from './text';
import type { StrategyRule } from './types';

export type Sentence = { fr: string; en: string };

/** A TextRef in both languages. */
export const bothLanguages = (ref: TextRef): Sentence => ({ fr: renderText(ref, 'fr'), en: renderText(ref, 'en') });

/** The sentence of a rule event: its condition with the actual numbers. `rule` adds what the event does not carry (where the money goes). */
export function eventTextRef(event: Pick<RuleEvent, 'decisionDay' | 'condition'>, rule?: StrategyRule): TextRef {
    const c = event.condition;
    const day = event.decisionDay;
    switch (c.kind) {
        case 'drawdown_guard':
            return strategyRef(c.phase === 'enter' ? 'strat.event.guard_enter' : 'strat.event.guard_exit', {
                day, fallPct: c.fallPct, thresholdPct: c.thresholdPct, valueCad: c.valueCad, peakValueCad: c.peakValueCad,
                movePct: rule?.kind === 'drawdown_guard' ? rule.movePct : 0, defensive: rule?.kind === 'drawdown_guard' ? rule.defensiveSymbol : '',
            });
        case 'weight_cap': {
            const top = [...c.over].sort((a, b) => b.weightPct - a.weightPct)[0] ?? c.highest ?? { symbol: '', weightPct: 0 };
            return strategyRef('strat.event.weight_cap', { day, symbol: top.symbol, weightPct: top.weightPct, capPct: c.capPct, others: Math.max(0, c.over.length - 1), proceeds: rule?.kind === 'weight_cap' ? rule.proceedsSymbol ?? null : null });
        }
        case 'allocation_target':
            return strategyRef(c.mode === 'quarterly' ? 'strat.event.rebalance_quarterly' : 'strat.event.rebalance_drift', { day, quarter: c.quarter, maxDriftPts: c.maxDriftPts, driftOf: c.driftOf, thresholdPts: c.thresholdPts });
        case 'periodic_purchase':
            return strategyRef('strat.event.periodic_purchase', { day, amountCad: c.amountCad, unit: c.unit, n: c.n });
        case 'price_threshold':
            return strategyRef('strat.event.price_threshold', { day, symbol: c.symbol, trigger: c.trigger, price: c.price, currency: c.currency, threshold: c.threshold, changePct: c.changePct });
    }
}

export type OrderSentenceInput = {
    side: 'buy' | 'sell'; symbol: string; quantity: number; priceCad: number; valueCad: number; feeCad: number;
    /** An OrderPurpose, or 'initial' for the starting purchase. */
    purpose: string;
    decisionDay: string; executionDay: string;
    adjustment?: { reason: string; requestedValueCad: number };
};

/** The sentence of one filled order. */
export const orderTextRef = (o: OrderSentenceInput): TextRef => strategyRef('strat.order', {
    side: o.side, symbol: o.symbol, quantity: o.quantity, priceCad: o.priceCad, valueCad: o.valueCad, feeCad: o.feeCad, purpose: o.purpose,
    decisionDay: o.decisionDay, executionDay: o.executionDay, adjustment: o.adjustment?.reason ?? null, requestedValueCad: o.adjustment?.requestedValueCad ?? null,
});

/** The sentence of an order that was not placed, with its reason. */
export const dropTextRef = (d: DroppedOrder): TextRef => strategyRef('strat.drop', {
    symbol: d.order.symbol, side: d.order.side, reason: d.reason, valueCad: d.order.estValueCad, minOrderCad: d.values.minOrderCad ?? null,
});
