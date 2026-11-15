// THE rules evaluator. One function, used by the live app (lib/services/rules-engine.ts) and by the replay
// (lib/replay/engine): the replay never rewrites this logic. Pure: no I/O, no clock, no randomness.
//
// Input: the portfolio as it stands at the close of day J, with only what is known at J. Output: the rule events
// decided at J, in order, each with the numbers its condition was tested on and the orders it asks for. Nothing is
// executed here: the caller fills the orders (the replay at the price of J+1, the live app through simulateTrade).
//
// Rules of the road, all read from rules/v1.json (block `strategy`, agreed on 2026-11-15):
//  - Priority on one day: drawdown guard, then weight cap, then rebalancing (allocation target), then periodic
//    purchase, then price thresholds. Each rule sees the portfolio as the rules before it would leave it (their
//    orders applied at the prices of J), so two rules never spend the same cash or sell the same units.
//  - Anti-oscillation: a rule that fired cannot fire again within 5 trading days (price thresholds keep their V1
//    delay of one market day).
//  - Orders under 25 CAD are dropped, with the reason.
//  - No short selling and no purchase without cash: an order is reduced to what is held or to the cash available
//    (reason recorded on the order), or refused when nothing is left. A price-threshold order is never reduced:
//    the user wrote its size, so it is filled as written or refused.
//  - While a drawdown guard is active, rebalancing is suspended (it would undo the guard) and the guard's defensive
//    holding is exempt from the weight cap. Periodic purchases go on.
//  - Target weights used by the guard's return and by periodic purchases: those of the strategy's first allocation
//    rule, or the starting weights of the portfolio (context.baseWeights) when it has none.

import type { StrategyConfig } from './config';
import type { AllocationTarget, AllocationTargetRule, DrawdownGuardRule, PeriodicPurchaseRule, PriceThresholdRule, RuleKind, StrategyRule, TriggerType, WeightCapRule } from './types';

const EPS = 1e-9;

/** What is known about one symbol at the close of J. `price` is in the listing currency, `priceCad` in CAD. */
export type PricePoint = { price: number; currency: string; priceCad: number; changePct?: number };

export type PortfolioState = {
    /** Trading-day counter; only differences matter (anti-oscillation, "every N trading days"). */
    dayIndex: number;
    /** J, as an ISO date. */
    date: string;
    /** The trading day before J; absent on the first day (nothing calendar-based fires then). */
    previousDate?: string;
    cashCad: number;
    /** Units held per symbol. */
    positions: Record<string, number>;
    /** Prices known at J. A symbol absent from here cannot be ordered. */
    prices: Record<string, PricePoint>;
    /** The highest portfolio value seen so far (contributions excluded by the caller, see the replay engine). */
    peakValueCad: number;
    /** dayIndex of each rule's last firing. */
    lastFiredDay: Record<string, number>;
    /** Drawdown guards currently holding their defensive position. */
    guardActive: Record<string, boolean>;
    /** Price-threshold rules written to fire once that have fired. */
    spent: Record<string, boolean>;
};

export type EvalContext = {
    config: StrategyConfig;
    /** The starting weights of the portfolio, in percent per symbol. */
    baseWeights: Record<string, number>;
    /** dayIndex the strategy started on: the anchor of "every N trading days" before a first purchase. */
    startDayIndex?: number;
};

export type OrderPurpose = 'guard_enter' | 'guard_exit' | 'cap_trim' | 'cap_proceeds' | 'rebalance' | 'periodic_purchase' | 'price_threshold';
export type OrderAdjustment = { reason: 'reduced_to_cash' | 'reduced_to_position' | 'reduced_to_cap'; requestedValueCad: number };
export type DropReason = 'below_min_order' | 'no_price' | 'insufficient_cash' | 'insufficient_position';

/** A sale carries the units to sell (decided at J); a purchase carries the CAD amount to spend, or units (price threshold by quantity). */
export type ProposedOrder = {
    symbol: string;
    side: 'buy' | 'sell';
    quantity?: number;
    amountCad?: number;
    /** Value at the price of J. */
    estValueCad: number;
    purpose: OrderPurpose;
    adjustment?: OrderAdjustment;
};

export type DroppedOrder = { order: ProposedOrder; reason: DropReason; values: Record<string, number> };

/** The numbers a rule's condition was tested on. */
export type RuleCondition =
    | { kind: 'price_threshold'; symbol: string; trigger: TriggerType; threshold: number; price: number; currency: string; changePct: number | null; met: boolean }
    | { kind: 'allocation_target'; mode: 'quarterly' | 'drift'; maxDriftPts: number; driftOf: string; thresholdPts: number | null; quarter: string; met: boolean }
    | { kind: 'weight_cap'; capPct: number; over: Array<{ symbol: string; weightPct: number }>; highest: { symbol: string; weightPct: number } | null; met: boolean }
    | { kind: 'drawdown_guard'; phase: 'enter' | 'exit'; fallPct: number; thresholdPct: number; valueCad: number; peakValueCad: number; met: boolean }
    | { kind: 'periodic_purchase'; unit: 'month' | 'trading_days'; n: number | null; daysSinceLast: number | null; amountCad: number; met: boolean };

export type RuleEvent = {
    ruleId: string;
    ruleVersion: number;
    kind: RuleKind;
    /** J: the day the decision was taken on. */
    decisionDay: string;
    decisionDayIndex: number;
    condition: RuleCondition;
    orders: ProposedOrder[];
    dropped: DroppedOrder[];
    /** New cash the rule brings in (periodic purchase); the caller adds it when it executes the orders. */
    contributionCad?: number;
    guard?: 'entered' | 'exited';
};

export type SkipReason = 'condition_not_met' | 'cooldown' | 'spent' | 'suspended_by_guard' | 'no_price' | 'orders_refused';
export type SkippedRule = {
    ruleId: string;
    kind: RuleKind;
    reason: SkipReason;
    condition?: RuleCondition;
    /** For 'orders_refused': the orders the rule asked for and why each was dropped. */
    dropped?: DroppedOrder[];
    values?: Record<string, number>;
};

export type Evaluation = {
    /** The rules that fired, in priority order. */
    events: RuleEvent[];
    /** The rules that did not, each with its reason. */
    skipped: SkippedRule[];
    /** The firing memory after this day, to be given back as the next state's lastFiredDay / guardActive / spent. */
    next: Pick<PortfolioState, 'lastFiredDay' | 'guardActive' | 'spent'>;
};

// ---------------------------------------------------------------- helpers

type Book = { cashCad: number; positions: Record<string, number> };
type Prices = Record<string, PricePoint>;

/** Cash plus every priced position, in CAD. */
export function portfolioValueCad(book: Book, prices: Prices): number {
    let total = book.cashCad;
    for (const symbol of Object.keys(book.positions)) total += (book.positions[symbol] ?? 0) * (prices[symbol]?.priceCad ?? 0);
    return total;
}

const valueOf = (book: Book, prices: Prices, symbol: string): number => (book.positions[symbol] ?? 0) * (prices[symbol]?.priceCad ?? 0);
const quarterOf = (date: string): string => `${date.slice(0, 4)}-Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`;
const monthOf = (date: string): string => date.slice(0, 7);

/** The V1 trigger test, on a listing-currency price and the day's % change. Strict: the threshold itself does not fire. */
export function testPriceTrigger(trigger: { type: TriggerType; value: number }, point: Pick<PricePoint, 'price' | 'changePct'>): boolean {
    switch (trigger.type) {
        case 'price_below': return point.price < trigger.value;
        case 'price_above': return point.price > trigger.value;
        case 'change_pct_below': return point.changePct !== undefined && point.changePct < trigger.value;
        case 'change_pct_above': return point.changePct !== undefined && point.changePct > trigger.value;
    }
}

/** Target weights in percent per symbol. A group's weight is shared among its members by their current value (equally when the group holds nothing). */
export function expandTargets(targets: AllocationTarget[], book: Book, prices: Prices): Record<string, number> {
    const weights: Record<string, number> = {};
    for (const target of targets) {
        if ('symbol' in target) {
            weights[target.symbol] = (weights[target.symbol] ?? 0) + target.weightPct;
            continue;
        }
        const members = target.symbols.filter((s) => prices[s]);
        const held = members.reduce((sum, s) => sum + valueOf(book, prices, s), 0);
        for (const s of members) weights[s] = (weights[s] ?? 0) + target.weightPct * (held > EPS ? valueOf(book, prices, s) / held : 1 / members.length);
    }
    return weights;
}

function targetsOf(rules: StrategyRule[], context: EvalContext, book: Book, prices: Prices): Record<string, number> {
    const allocation = rules.find((rule): rule is AllocationTargetRule => rule.kind === 'allocation_target');
    return allocation ? expandTargets(allocation.targets, book, prices) : { ...context.baseWeights };
}

/**
 * Applies the constraints to the orders a rule asks for, in order (sales first, so their proceeds can pay the
 * purchases), and applies the accepted ones to the working book at the prices of J.
 */
function settle(book: Book, prices: Prices, wanted: ProposedOrder[], config: StrategyConfig, policy: 'reduce' | 'refuse'): { orders: ProposedOrder[]; dropped: DroppedOrder[] } {
    const orders: ProposedOrder[] = [];
    const dropped: DroppedOrder[] = [];
    const drop = (order: ProposedOrder, reason: DropReason, values: Record<string, number> = {}) => dropped.push({ order, reason, values });

    for (const order of wanted.filter((o) => o.side === 'sell')) {
        const point = prices[order.symbol];
        if (!point) { drop(order, 'no_price'); continue; }
        const held = book.positions[order.symbol] ?? 0;
        let quantity = order.quantity ?? (order.amountCad ?? 0) / point.priceCad;
        let adjustment: OrderAdjustment | undefined;
        if (quantity > held + EPS) {
            if (policy === 'refuse' || !(held > EPS)) { drop(order, 'insufficient_position', { held, quantity }); continue; }
            adjustment = { reason: 'reduced_to_position', requestedValueCad: quantity * point.priceCad };
            quantity = held;
        }
        quantity = Math.min(quantity, held);
        const estValueCad = quantity * point.priceCad;
        if (estValueCad < config.minOrderCad) { drop({ ...order, estValueCad }, 'below_min_order', { valueCad: estValueCad, minOrderCad: config.minOrderCad }); continue; }
        book.positions[order.symbol] = held - quantity;
        book.cashCad += estValueCad;
        orders.push({ symbol: order.symbol, side: 'sell', quantity, estValueCad, purpose: order.purpose, ...(adjustment ? { adjustment } : {}) });
    }

    const buys = wanted.filter((o) => o.side === 'buy');
    const costOf = (order: ProposedOrder, point: PricePoint) => order.amountCad ?? (order.quantity ?? 0) * point.priceCad;
    const total = buys.reduce((sum, order) => sum + (prices[order.symbol] ? costOf(order, prices[order.symbol]) : 0), 0);
    const available = Math.max(0, book.cashCad);
    // Purchases that together exceed the cash are all reduced in the same proportion
    const scale = total > available + EPS ? available / total : 1;
    for (const order of buys) {
        const point = prices[order.symbol];
        if (!point) { drop(order, 'no_price'); continue; }
        const asked = costOf(order, point);
        if (scale < 1 && (policy === 'refuse' || !(available > EPS))) { drop(order, 'insufficient_cash', { cashCad: available, costCad: asked }); continue; }
        const cost = asked * scale;
        if (cost < config.minOrderCad) { drop({ ...order, estValueCad: cost }, 'below_min_order', { valueCad: cost, minOrderCad: config.minOrderCad }); continue; }
        book.cashCad -= cost;
        book.positions[order.symbol] = (book.positions[order.symbol] ?? 0) + cost / point.priceCad;
        const adjustment: OrderAdjustment | undefined = scale < 1 ? { reason: 'reduced_to_cash', requestedValueCad: asked } : order.adjustment;
        const size = order.quantity !== undefined && scale === 1 ? { quantity: order.quantity } : { amountCad: cost };
        orders.push({ symbol: order.symbol, side: 'buy', ...size, estValueCad: cost, purpose: order.purpose, ...(adjustment ? { adjustment } : {}) });
    }
    return { orders, dropped };
}

/** The sales and purchases that bring each listed symbol to its target weight, at the prices of J. */
function ordersToTargets(book: Book, prices: Prices, weights: Record<string, number>, purpose: OrderPurpose): ProposedOrder[] {
    const total = portfolioValueCad(book, prices);
    const wanted: ProposedOrder[] = [];
    for (const symbol of Object.keys(weights).sort()) {
        const point = prices[symbol];
        const delta = (weights[symbol] / 100) * total - valueOf(book, prices, symbol);
        if (Math.abs(delta) < EPS) continue;
        if (!point) wanted.push({ symbol, side: delta > 0 ? 'buy' : 'sell', amountCad: Math.abs(delta), estValueCad: Math.abs(delta), purpose });
        else if (delta < 0) wanted.push({ symbol, side: 'sell', quantity: -delta / point.priceCad, estValueCad: -delta, purpose });
        else wanted.push({ symbol, side: 'buy', amountCad: delta, estValueCad: delta, purpose });
    }
    return wanted;
}

// ---------------------------------------------------------------- one rule at a time

type Outcome =
    | { fired: true; condition: RuleCondition; orders: ProposedOrder[]; dropped: DroppedOrder[]; contributionCad?: number; guard?: 'entered' | 'exited' }
    | { fired: false; skip: Omit<SkippedRule, 'ruleId' | 'kind'> };

type Run = { state: PortfolioState; rules: StrategyRule[]; context: EvalContext; book: Book; next: Evaluation['next'] };

const notMet = (condition: RuleCondition): Outcome => ({ fired: false, skip: { reason: 'condition_not_met', condition } });
/** A rule whose condition is met fires when at least one order survives the constraints. */
const withOrders = (condition: RuleCondition, settled: { orders: ProposedOrder[]; dropped: DroppedOrder[] }, extra: { contributionCad?: number; guard?: 'entered' | 'exited' } = {}): Outcome =>
    settled.orders.length > 0 || extra.contributionCad !== undefined || extra.guard === 'exited'
        ? { fired: true, condition, ...settled, ...extra }
        : { fired: false, skip: { reason: 'orders_refused', condition, dropped: settled.dropped } };

function drawdownGuard(rule: DrawdownGuardRule, run: Run): Outcome {
    const { state, book, context } = run;
    // Value and peak of the day itself: orders decided today by other rules do not change the value at J's prices
    const valueCad = portfolioValueCad(state, state.prices);
    const peakValueCad = Math.max(state.peakValueCad, valueCad);
    const fallPct = peakValueCad > 0 ? (1 - valueCad / peakValueCad) * 100 : 0;
    const active = run.next.guardActive[rule.id] === true;
    if (!active) {
        const condition: RuleCondition = { kind: 'drawdown_guard', phase: 'enter', fallPct, thresholdPct: rule.triggerDrawdownPct, valueCad, peakValueCad, met: fallPct > rule.triggerDrawdownPct };
        if (!condition.met) return notMet(condition);
        if (!state.prices[rule.defensiveSymbol]) return { fired: false, skip: { reason: 'no_price', condition } };
        // Move movePct of every other holding to the defensive symbol; cash is left as it is
        const sales: ProposedOrder[] = Object.keys(book.positions).sort()
            .filter((s) => s !== rule.defensiveSymbol && (book.positions[s] ?? 0) > EPS && state.prices[s])
            .map((s) => ({ symbol: s, side: 'sell' as const, quantity: book.positions[s] * (rule.movePct / 100), estValueCad: valueOf(book, state.prices, s) * (rule.movePct / 100), purpose: 'guard_enter' as const }));
        const sold = settle(book, state.prices, sales, context.config, 'reduce');
        const proceeds = sold.orders.reduce((sum, o) => sum + o.estValueCad, 0);
        const bought = proceeds > 0
            ? settle(book, state.prices, [{ symbol: rule.defensiveSymbol, side: 'buy', amountCad: proceeds, estValueCad: proceeds, purpose: 'guard_enter' }], context.config, 'reduce')
            : { orders: [], dropped: [] };
        const outcome = withOrders(condition, { orders: [...sold.orders, ...bought.orders], dropped: [...sold.dropped, ...bought.dropped] });
        return outcome.fired ? { ...outcome, guard: 'entered' } : outcome;
    }
    const condition: RuleCondition = { kind: 'drawdown_guard', phase: 'exit', fallPct, thresholdPct: rule.recoverDrawdownPct, valueCad, peakValueCad, met: fallPct < rule.recoverDrawdownPct };
    if (!condition.met) return notMet(condition);
    // Back to the target weights; the defensive holding returns to its own target (none when it is not one)
    const targets = targetsOf(run.rules, context, book, state.prices);
    targets[rule.defensiveSymbol] ??= 0;
    const back = settle(book, state.prices, ordersToTargets(book, state.prices, targets, 'guard_exit'), context.config, 'reduce');
    return withOrders(condition, back, { guard: 'exited' });
}

function weightCap(rule: WeightCapRule, run: Run): Outcome {
    const { state, book, context } = run;
    const total = portfolioValueCad(book, state.prices);
    // The defensive holding of an active guard is exempt: capping it would undo the guard
    const exempt = new Set(run.rules.filter((r): r is DrawdownGuardRule => r.kind === 'drawdown_guard' && run.next.guardActive[r.id] === true).map((r) => r.defensiveSymbol));
    const weights = Object.keys(book.positions).sort()
        .filter((s) => (book.positions[s] ?? 0) > EPS && state.prices[s] && !exempt.has(s))
        .map((s) => ({ symbol: s, weightPct: total > 0 ? (valueOf(book, state.prices, s) / total) * 100 : 0 }));
    const over = weights.filter((w) => w.weightPct > rule.maxWeightPct + EPS);
    const highest = weights.reduce<{ symbol: string; weightPct: number } | null>((top, w) => (!top || w.weightPct > top.weightPct ? w : top), null);
    const condition: RuleCondition = { kind: 'weight_cap', capPct: rule.maxWeightPct, over, highest, met: over.length > 0 };
    if (!condition.met) return notMet(condition);

    const sales: ProposedOrder[] = over.map((w) => {
        const excessCad = ((w.weightPct - rule.maxWeightPct) / 100) * total;
        return { symbol: w.symbol, side: 'sell', quantity: excessCad / state.prices[w.symbol].priceCad, estValueCad: excessCad, purpose: 'cap_trim' };
    });
    const sold = settle(book, state.prices, sales, context.config, 'reduce');
    const proceeds = sold.orders.reduce((sum, o) => sum + o.estValueCad, 0);
    const to = rule.proceedsSymbol;
    if (!to || proceeds <= 0 || over.some((w) => w.symbol === to)) return withOrders(condition, sold);
    // The named symbol receives the proceeds, but never past the cap itself
    const room = Math.max(0, (rule.maxWeightPct / 100) * total - valueOf(book, state.prices, to));
    const amountCad = Math.min(proceeds, room);
    const purchase: ProposedOrder = { symbol: to, side: 'buy', amountCad, estValueCad: amountCad, purpose: 'cap_proceeds', ...(amountCad < proceeds - EPS ? { adjustment: { reason: 'reduced_to_cap' as const, requestedValueCad: proceeds } } : {}) };
    const bought = settle(book, state.prices, [purchase], context.config, 'reduce');
    return withOrders(condition, { orders: [...sold.orders, ...bought.orders], dropped: [...sold.dropped, ...bought.dropped] });
}

function allocationTarget(rule: AllocationTargetRule, run: Run): Outcome {
    const { state, book, context } = run;
    if (Object.values(run.next.guardActive).some(Boolean)) return { fired: false, skip: { reason: 'suspended_by_guard' } };
    const total = portfolioValueCad(book, state.prices);
    let maxDriftPts = 0;
    let driftOf = '';
    for (const target of rule.targets) {
        const members = 'symbol' in target ? [target.symbol] : target.symbols;
        const currentPct = total > 0 ? (members.reduce((sum, s) => sum + valueOf(book, state.prices, s), 0) / total) * 100 : 0;
        const drift = Math.abs(currentPct - target.weightPct);
        if (drift > maxDriftPts) {
            maxDriftPts = drift;
            driftOf = 'symbol' in target ? target.symbol : target.group;
        }
    }
    const quarter = quarterOf(state.date);
    const met = rule.rebalance.mode === 'quarterly'
        ? state.previousDate !== undefined && quarterOf(state.previousDate) !== quarter       // first trading day of a new quarter
        : maxDriftPts > rule.rebalance.driftPts;
    const condition: RuleCondition = { kind: 'allocation_target', mode: rule.rebalance.mode, maxDriftPts, driftOf, thresholdPts: rule.rebalance.mode === 'drift' ? rule.rebalance.driftPts : null, quarter, met };
    if (!met) return notMet(condition);
    return withOrders(condition, settle(book, state.prices, ordersToTargets(book, state.prices, expandTargets(rule.targets, book, state.prices), 'rebalance'), context.config, 'reduce'));
}

function periodicPurchase(rule: PeriodicPurchaseRule, run: Run): Outcome {
    const { state, book, context } = run;
    const last = state.lastFiredDay[rule.id];
    const daysSinceLast = state.dayIndex - (last ?? context.startDayIndex ?? 0);
    const met = rule.every.unit === 'month'
        ? state.previousDate !== undefined && monthOf(state.previousDate) !== monthOf(state.date)     // first trading day of a new month
        : daysSinceLast >= rule.every.n;
    const condition: RuleCondition = { kind: 'periodic_purchase', unit: rule.every.unit, n: rule.every.unit === 'trading_days' ? rule.every.n : null, daysSinceLast: last === undefined && rule.every.unit === 'month' ? null : daysSinceLast, amountCad: rule.amountCad, met };
    if (!met) return notMet(condition);
    // The contribution is new cash: it is split by the target weights of the symbols that have a price
    const weights = targetsOf(run.rules, context, book, state.prices);
    const symbols = Object.keys(weights).sort().filter((s) => weights[s] > 0 && state.prices[s]);
    const sum = symbols.reduce((acc, s) => acc + weights[s], 0);
    book.cashCad += rule.amountCad;
    const wanted: ProposedOrder[] = symbols.map((s) => ({ symbol: s, side: 'buy', amountCad: rule.amountCad * (weights[s] / sum), estValueCad: rule.amountCad * (weights[s] / sum), purpose: 'periodic_purchase' }));
    return withOrders(condition, settle(book, state.prices, wanted, context.config, 'reduce'), { contributionCad: rule.amountCad });
}

function priceThreshold(rule: PriceThresholdRule, run: Run): Outcome {
    const { state, book, context } = run;
    if (run.next.spent[rule.id]) return { fired: false, skip: { reason: 'spent' } };
    const point = state.prices[rule.symbol];
    if (!point) return { fired: false, skip: { reason: 'no_price' } };
    const condition: RuleCondition = { kind: 'price_threshold', symbol: rule.symbol, trigger: rule.trigger.type, threshold: rule.trigger.value, price: point.price, currency: point.currency, changePct: point.changePct ?? null, met: testPriceTrigger(rule.trigger, point) };
    if (!condition.met) return notMet(condition);
    const { side, amountCad, quantity } = rule.action;
    const estValueCad = amountCad ?? (quantity ?? 0) * point.priceCad;
    const wanted: ProposedOrder = side === 'buy'
        ? { symbol: rule.symbol, side, ...(quantity !== undefined ? { quantity } : { amountCad }), estValueCad, purpose: 'price_threshold' }
        : { symbol: rule.symbol, side, quantity: quantity ?? (amountCad ?? 0) / point.priceCad, estValueCad, purpose: 'price_threshold' };
    return withOrders(condition, settle(book, state.prices, [wanted], context.config, 'refuse'));
}

// ---------------------------------------------------------------- the evaluator

/**
 * Evaluates the rules on the state at the close of J. Rules run in the configured priority (ties keep the order of
 * the list). Returns the events (rules that fired, with their orders), the rules that did not fire with the reason,
 * and the firing memory for the next day. Executes nothing and changes neither `state` nor `rules`.
 */
export function evaluateRules(state: PortfolioState, rules: StrategyRule[], context: EvalContext): Evaluation {
    const { config } = context;
    const rank = (kind: RuleKind) => { const at = config.priority.indexOf(kind); return at < 0 ? config.priority.length : at; };
    const ordered = rules.map((rule, index) => ({ rule, index })).sort((a, b) => rank(a.rule.kind) - rank(b.rule.kind) || a.index - b.index).map((entry) => entry.rule);

    const run: Run = {
        state,
        rules,
        context,
        book: { cashCad: state.cashCad, positions: { ...state.positions } },
        next: { lastFiredDay: { ...state.lastFiredDay }, guardActive: { ...state.guardActive }, spent: { ...state.spent } },
    };
    const events: RuleEvent[] = [];
    const skipped: SkippedRule[] = [];

    for (const rule of ordered) {
        const last = state.lastFiredDay[rule.id];
        const minDays = rule.kind === 'price_threshold' ? config.priceThresholdMinDays : config.antiOscillationTradingDays;
        if (rule.kind === 'price_threshold' && run.next.spent[rule.id]) {
            skipped.push({ ruleId: rule.id, kind: rule.kind, reason: 'spent' });
            continue;
        }
        if (last !== undefined && state.dayIndex - last < minDays) {
            skipped.push({ ruleId: rule.id, kind: rule.kind, reason: 'cooldown', values: { daysSinceLast: state.dayIndex - last, minDays } });
            continue;
        }
        const outcome =
            rule.kind === 'drawdown_guard' ? drawdownGuard(rule, run)
            : rule.kind === 'weight_cap' ? weightCap(rule, run)
            : rule.kind === 'allocation_target' ? allocationTarget(rule, run)
            : rule.kind === 'periodic_purchase' ? periodicPurchase(rule, run)
            : priceThreshold(rule, run);
        if (!outcome.fired) {
            skipped.push({ ruleId: rule.id, kind: rule.kind, ...outcome.skip });
            continue;
        }
        run.next.lastFiredDay[rule.id] = state.dayIndex;
        if (outcome.guard) run.next.guardActive[rule.id] = outcome.guard === 'entered';
        if (rule.kind === 'price_threshold' && rule.once) run.next.spent[rule.id] = true;
        events.push({
            ruleId: rule.id,
            ruleVersion: rule.version,
            kind: rule.kind,
            decisionDay: state.date,
            decisionDayIndex: state.dayIndex,
            condition: outcome.condition,
            orders: outcome.orders,
            dropped: outcome.dropped,
            ...(outcome.contributionCad !== undefined ? { contributionCad: outcome.contributionCad } : {}),
            ...(outcome.guard ? { guard: outcome.guard } : {}),
        });
    }
    return { events, skipped, next: run.next };
}
