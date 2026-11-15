// The daily loop of the replay (pure, deterministic). One function runs every series: the portfolio bought and
// held (no rules), the portfolio with the strategy, and the reference portfolios.
//
// On each day t, in this order:
//   1. the orders decided at the close of t-1 are filled at the price of t (adjusted close, in CAD at the day's rate);
//   2. the portfolio is valued at the close of t and reconciled against an independent ledger of the journal;
//   3. the rules are evaluated on that state by the shared evaluator (lib/strategy/evaluate.ts), which only ever
//      sees prices dated t or earlier; what it decides waits for t+1.
// So no decision can use a price it could not have known: changing the price of day t+k changes nothing before t+k.

import type { StrategyConfig } from '@/lib/strategy/config';
import { evaluateRules, portfolioValueCad, type OrderAdjustment, type PortfolioState, type PricePoint, type ProposedOrder, type RuleEvent, type SkipReason } from '@/lib/strategy/evaluate';
import { bothLanguages, dropTextRef, eventTextRef, orderTextRef } from '@/lib/strategy/sentence';
import type { StrategyRule } from '@/lib/strategy/types';
import { ReplayError, type NotPlaced, type ReplayData, type ReplayOrder, type ReplayRuleEvent, type RuleStat, type SeriesName } from './types';

const EPS = 1e-9;

export type SeriesRun = {
    /** Index into data.calendar of the first day. */
    from: number;
    valueCad: number[];
    cashCad: number[];
    contributedCad: number[];
    index: number[];
    orders: ReplayOrder[];
    events: ReplayRuleEvent[];
    ruleStats: RuleStat[];
    marketCad: number;
    currencyCad: number;
    feesCad: number;
    /** Value of the orders placed by rules (the starting purchase excluded). */
    tradedCad: number;
    finalPositions: Record<string, number>;
};

export type SimulateOptions = {
    replayId: string;
    series: SeriesName | 'benchmark';
    /** Index into data.calendar of the first day (the starting purchase is made at its close). */
    from: number;
    /** Starting weights in percent per symbol; what is left under 100 stays in cash. */
    weights: Record<string, number>;
    capitalCad: number;
    rules: StrategyRule[];
    feePerOrderCad: number;
    config: StrategyConfig;
};

/** Cash and units as the journal alone says they should be. */
export type Ledger = { cashCad: number; positions: Record<string, number> };

/**
 * The reconciliation invariant: the cash and the units of the running portfolio must equal what the starting
 * capital, the contributions and the journal of orders (with their fees) add up to. Dividends never appear: they
 * are inside the adjusted close, reinvested in the holding. Throws ReplayError('invariant') on any gap.
 */
export function assertReconciled(book: Ledger, ledger: Ledger, where: string): void {
    const close = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
    if (!close(book.cashCad, ledger.cashCad)) throw new ReplayError('invariant', `${where}: cash ${book.cashCad} does not match the journal (${ledger.cashCad})`);
    for (const symbol of new Set([...Object.keys(book.positions), ...Object.keys(ledger.positions)])) {
        const held = book.positions[symbol] ?? 0;
        const expected = ledger.positions[symbol] ?? 0;
        if (!close(held, expected)) throw new ReplayError('invariant', `${where}: ${symbol} holds ${held} units, the journal says ${expected}`);
    }
}

/** Applies journal entries (and a contribution) to a ledger: the independent side of the reconciliation. */
export function applyToLedger(ledger: Ledger, orders: ReadonlyArray<Pick<ReplayOrder, 'symbol' | 'side' | 'quantity' | 'valueCad' | 'feeCad'>>, contributionCad = 0): void {
    ledger.cashCad += contributionCad;
    for (const order of orders) {
        const sign = order.side === 'buy' ? 1 : -1;
        ledger.cashCad -= sign * order.valueCad + order.feeCad;
        ledger.positions[order.symbol] = (ledger.positions[order.symbol] ?? 0) + sign * order.quantity;
    }
}

export function simulateSeries(data: ReplayData, opts: SimulateOptions): SeriesRun {
    const { calendar, symbols, usdcad } = data;
    const { from, rules, config, feePerOrderCad: fee, capitalCad } = opts;
    const last = calendar.length - 1;
    const names = Object.keys(symbols).sort();
    const rateOf = (symbol: string, t: number) => (symbols[symbol].currency === 'USD' ? usdcad[t] : 1);
    const priceCadOf = (symbol: string, t: number): number | null => {
        const adj = symbols[symbol]?.adj[t];
        return adj === null || adj === undefined ? null : adj * rateOf(symbol, t);
    };
    /** What is known at the close of t: nothing dated after t is ever read. */
    const pricesAt = (t: number): Record<string, PricePoint> => {
        const prices: Record<string, PricePoint> = {};
        for (const symbol of names) {
            const priceCad = priceCadOf(symbol, t);
            if (priceCad === null) continue;
            const close = symbols[symbol].close[t] ?? symbols[symbol].adj[t]!;
            const before = t > 0 ? symbols[symbol].close[t - 1] : null;
            prices[symbol] = { price: close, currency: symbols[symbol].currency, priceCad, ...(before ? { changePct: (close / before - 1) * 100 } : {}) };
        }
        return prices;
    };

    const book: Ledger = { cashCad: capitalCad, positions: {} };
    const ledger: Ledger = { cashCad: capitalCad, positions: {} };
    const valueAt = (t: number) => book.cashCad + Object.keys(book.positions).reduce((sum, s) => sum + book.positions[s] * (priceCadOf(s, t) ?? 0), 0);

    const run: SeriesRun = { from, valueCad: [], cashCad: [], contributedCad: [], index: [], orders: [], events: [], ruleStats: [], marketCad: 0, currencyCad: 0, feesCad: 0, tradedCad: 0, finalPositions: {} };
    const stats = new Map<string, RuleStat>(rules.map((rule) => [rule.id, { ruleId: rule.id, kind: rule.kind, version: rule.version, fired: 0, skipped: {} }]));
    const ruleOf = new Map(rules.map((rule) => [rule.id, rule]));
    let contributed = 0;
    let peak = capitalCad;
    let memory: Pick<PortfolioState, 'lastFiredDay' | 'guardActive' | 'spent'> = { lastFiredDay: {}, guardActive: {}, spent: {} };
    let pending: Array<{ event: RuleEvent; valueAtDecisionCad: number }> = [];

    /** Fills one order at the price of day t and writes it to the journal; returns null (with the reason) when it cannot be filled. */
    const fill = (t: number, order: ProposedOrder | (Omit<ProposedOrder, 'purpose'> & { purpose: 'initial' }), ruleId: string | null, decisionDay: string): ReplayOrder | { refused: NotPlaced['reason'] } => {
        const priceCad = priceCadOf(order.symbol, t);
        if (priceCad === null) return { refused: 'no_price' };
        const held = book.positions[order.symbol] ?? 0;
        const valueBeforeCad = valueAt(t);
        let quantity: number;
        let adjustment: OrderAdjustment | undefined = order.adjustment;
        if (order.side === 'sell') {
            quantity = Math.min(order.quantity ?? (order.amountCad ?? 0) / priceCad, held);
            if (!(quantity > EPS)) return { refused: 'insufficient_position' };
            if (book.cashCad + quantity * priceCad - fee < -EPS) return { refused: 'insufficient_cash' };
        } else {
            const wanted = order.amountCad ?? (order.quantity ?? 0) * priceCad;
            const affordable = book.cashCad - fee;
            let amount = wanted;
            if (wanted > affordable + EPS) {
                // The price moved between the decision and the fill: reduce to the cash there is, or refuse a fixed-size order
                if (order.quantity !== undefined || affordable < config.minOrderCad) return { refused: 'insufficient_cash' };
                amount = affordable;
                adjustment = { reason: 'reduced_to_cash', requestedValueCad: wanted };
            }
            quantity = amount / priceCad;
        }
        const sign = order.side === 'buy' ? 1 : -1;
        const valueCad = quantity * priceCad;
        book.cashCad -= sign * valueCad + fee;
        if (Math.abs(book.cashCad) < EPS) book.cashCad = 0;
        const left = held + sign * quantity;
        if (left > EPS) book.positions[order.symbol] = left;
        else delete book.positions[order.symbol];
        run.feesCad += fee;
        if (order.purpose !== 'initial') run.tradedCad += valueCad;
        const rule = ruleId ? ruleOf.get(ruleId) : undefined;
        const executionDay = calendar[t];
        const sentenceRef = orderTextRef({ side: order.side, symbol: order.symbol, quantity, priceCad, valueCad, feeCad: fee, purpose: order.purpose, decisionDay, executionDay, adjustment });
        const entry: ReplayOrder = {
            id: `${opts.replayId}:${opts.series}:${run.orders.length + 1}`,
            origin: 'replay',
            replayId: opts.replayId,
            snapshotId: data.snapshotId,
            series: opts.series,
            ruleId,
            ruleVersion: rule?.version ?? null,
            purpose: order.purpose,
            decisionDay,
            executionDay,
            symbol: order.symbol,
            side: order.side,
            quantity,
            price: symbols[order.symbol].adj[t]!,
            currency: symbols[order.symbol].currency,
            usdcad: symbols[order.symbol].currency === 'USD' ? usdcad[t] : null,
            priceCad,
            valueCad,
            feeCad: fee,
            valueBeforeCad,
            valueAfterCad: valueBeforeCad - fee,
            cashAfterCad: book.cashCad,
            ...(adjustment ? { adjustment } : {}),
            sentenceRef,
            sentence: bothLanguages(sentenceRef),
        };
        run.orders.push(entry);
        return entry;
    };

    for (let t = from; t <= last; t++) {
        const day = calendar[t];
        const journalFrom = run.orders.length;
        let contributionToday = 0;
        const valueBefore = t === from ? capitalCad : run.valueCad[run.valueCad.length - 1];

        if (t === from) {
            // The starting purchase: the same in every series, at the close of the first day
            const held = Object.keys(opts.weights).filter((s) => opts.weights[s] > 0);
            const investable = capitalCad - held.length * fee;
            for (const symbol of held) {
                const filled = fill(t, { symbol, side: 'buy', amountCad: (opts.weights[symbol] / 100) * investable, estValueCad: (opts.weights[symbol] / 100) * investable, purpose: 'initial' }, null, day);
                if ('refused' in filled) throw new ReplayError('nothing_to_replay', `${symbol} has no price on ${day}`);
            }
        } else {
            // Market and currency effect of the day, on what was held overnight
            for (const symbol of Object.keys(book.positions)) {
                const quantity = book.positions[symbol];
                const p0 = symbols[symbol].adj[t - 1]!;
                const p1 = symbols[symbol].adj[t]!;
                const f0 = rateOf(symbol, t - 1);
                const f1 = rateOf(symbol, t);
                run.marketCad += quantity * (p1 - p0) * f0;
                run.currencyCad += quantity * p1 * (f1 - f0);
            }
            for (const { event, valueAtDecisionCad } of pending) {
                const rule = ruleOf.get(event.ruleId);
                const notPlaced: NotPlaced[] = event.dropped.map((d) => {
                    const ref = dropTextRef(d);
                    return { symbol: d.order.symbol, side: d.order.side, valueCad: d.order.estValueCad, reason: d.reason, at: 'decision', sentenceRef: ref, sentence: bothLanguages(ref) };
                });
                if (event.contributionCad) {
                    // New cash: counted apart, and the peak is raised in proportion so a deposit is never read as a recovery
                    const before = valueAt(t);
                    book.cashCad += event.contributionCad;
                    contributed += event.contributionCad;
                    contributionToday += event.contributionCad;
                    peak = before > 0 ? peak * ((before + event.contributionCad) / before) : peak + event.contributionCad;
                }
                const orderIds: string[] = [];
                for (const order of event.orders) {
                    const filled = fill(t, order, event.ruleId, event.decisionDay);
                    if ('refused' in filled) {
                        const ref = dropTextRef({ order, reason: filled.refused, values: { minOrderCad: config.minOrderCad } });
                        notPlaced.push({ symbol: order.symbol, side: order.side, valueCad: order.estValueCad, reason: filled.refused, at: 'execution', sentenceRef: ref, sentence: bothLanguages(ref) });
                    } else orderIds.push(filled.id);
                }
                const sentenceRef = eventTextRef(event, rule);
                run.events.push({
                    series: opts.series === 'benchmark' ? 'with' : opts.series,
                    ruleId: event.ruleId,
                    ruleVersion: event.ruleVersion,
                    kind: event.kind,
                    decisionDay: event.decisionDay,
                    executionDay: day,
                    condition: event.condition,
                    proposedOrders: event.orders,
                    orderIds,
                    notPlaced,
                    contributionCad: event.contributionCad ?? 0,
                    guard: event.guard ?? null,
                    valueAtDecisionCad,
                    valueAfterExecutionCad: valueAt(t),
                    sentenceRef,
                    sentence: bothLanguages(sentenceRef),
                });
            }
            pending = [];
        }

        // Reconciliation: the running book against the journal, then the value against the effects
        applyToLedger(ledger, run.orders.slice(journalFrom), contributionToday);
        assertReconciled(book, ledger, `${opts.series} ${day}`);
        const value = valueAt(t);
        const explained = capitalCad + contributed + run.marketCad + run.currencyCad - run.feesCad;
        if (Math.abs(value - explained) > 1e-6 * Math.max(1, Math.abs(value))) throw new ReplayError('invariant', `${opts.series} ${day}: value ${value} is not capital + contributions + market + currency - fees (${explained})`);

        // Time-weighted index: the day's contribution is taken out before the return is measured
        const dayReturn = valueBefore > 0 ? (value - contributionToday) / valueBefore - 1 : 0;
        run.index.push((t === from ? 100 : run.index[run.index.length - 1]) * (1 + dayReturn));
        run.valueCad.push(value);
        run.cashCad.push(book.cashCad);
        run.contributedCad.push(contributed);
        peak = t === from ? value : Math.max(peak, value);

        if (rules.length === 0 || t === last) continue;
        const state: PortfolioState = {
            dayIndex: t - from,
            date: day,
            ...(t > from ? { previousDate: calendar[t - 1] } : {}),
            cashCad: book.cashCad,
            positions: { ...book.positions },
            prices: pricesAt(t),
            peakValueCad: peak,
            ...memory,
        };
        const decided = evaluateRules(state, rules, { config, baseWeights: opts.weights, startDayIndex: 0 });
        memory = decided.next;
        const valueAtDecisionCad = portfolioValueCad(state, state.prices);
        pending = decided.events.map((event) => ({ event, valueAtDecisionCad }));
        for (const event of decided.events) stats.get(event.ruleId)!.fired++;
        for (const skip of decided.skipped) {
            const stat = stats.get(skip.ruleId)!;
            stat.skipped[skip.reason as SkipReason] = (stat.skipped[skip.reason as SkipReason] ?? 0) + 1;
        }
    }
    run.ruleStats = rules.map((rule) => stats.get(rule.id)!);
    run.finalPositions = { ...book.positions };
    return run;
}
