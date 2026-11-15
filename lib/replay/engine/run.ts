// The replay itself: two runs of the same starting portfolio (bought and held, then with the strategy), the
// reference portfolios, the comparison, each rule's contribution and the sensitivity variants. Pure and
// deterministic: the same data and parameters give the same replay id and the same result, to the last digit.

import { createHash } from 'node:crypto';
import { STRATEGY_CONFIG, type StrategyConfig } from '@/lib/strategy/config';
import { bothLanguages } from '@/lib/strategy/sentence';
import { strategyRef, type StrategyTextKey } from '@/lib/strategy/text';
import { strategySymbols, type Strategy, type StrategyRule } from '@/lib/strategy/types';
import { round } from '@/lib/xray/stats';
import { effectsOf, seriesMetrics } from './metrics';
import { simulateSeries, type SeriesRun } from './simulate';
import {
    ReplayError, type BenchmarkResult, type PortfolioWeight, type ReplayData, type ReplayParams, type ReplayResult, type ReplaySummary, type RuleContribution,
    type SensitivityReport, type SensitivityVariant, type SeriesResult, type Unreplayable, type UnreplayableReason,
} from './types';

export const ENGINE_VERSION = 'replay-engine-v1';
/** A symbol whose history stops more than this many trading days before the end of the replay is left out. */
const STALE_TRADING_DAYS = 5;

/** JSON with sorted keys: the same value always gives the same text. */
function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

/** The replay id: a hash of the snapshot id, the portfolio, the capital, the rules, the start date, the fee and the evaluator's constants. */
export function replayIdOf(snapshotId: string, params: ReplayParams): string {
    const config = params.config ?? STRATEGY_CONFIG;
    const key = canonical({
        engine: ENGINE_VERSION,
        snapshotId,
        portfolio: [...params.portfolio].map((p) => ({ symbol: p.symbol, weightPct: p.weightPct })).sort((a, b) => (a.symbol < b.symbol ? -1 : 1)),
        capitalCad: params.capitalCad,
        rules: params.strategy.rules,
        startDate: params.startDate,
        feePerOrderCad: params.feePerOrderCad,
        config,
    });
    return `rp_${createHash('sha256').update(key).digest('hex').slice(0, 20)}`;
}

const r2 = (values: number[]) => values.map((v) => round(v, 2));
const r4 = (values: number[]) => values.map((v) => round(v, 4));

function whyNot(data: ReplayData, symbol: string, from: number): { reason: UnreplayableReason; date: string | null } | null {
    const series = data.symbols[symbol];
    if (!series) return { reason: 'not_in_snapshot', date: null };
    if (series.adj[from] === null) return { reason: 'starts_later', date: series.firstDate };
    const lastIndex = data.calendar.length - 1;
    if (series.lastDate !== null && lastIndex - STALE_TRADING_DAYS > from && series.lastDate < data.calendar[lastIndex - STALE_TRADING_DAYS]) return { reason: 'ends_earlier', date: series.lastDate };
    return null;
}

const unreplayable = (symbol: string, role: Unreplayable['role'], why: { reason: UnreplayableReason; date: string | null }): Unreplayable => {
    const sentenceRef = strategyRef('strat.unreplayable', { symbol, reason: why.reason, date: why.date });
    return { symbol, role, ...why, sentenceRef, sentence: bothLanguages(sentenceRef) };
};

function seriesResult(data: ReplayData, run: SeriesRun, dates: string[], capitalCad: number): SeriesResult {
    const at = data.calendar.length - 1;
    const final = run.valueCad[run.valueCad.length - 1];
    return {
        valueCad: r2(run.valueCad),
        cashCad: r2(run.cashCad),
        contributedCad: r2(run.contributedCad),
        index: r4(run.index),
        metrics: seriesMetrics(run, dates),
        effects: effectsOf(run, capitalCad),
        finalPositions: Object.keys(run.finalPositions).sort().map((symbol) => {
            const valueCad = run.finalPositions[symbol] * data.symbols[symbol].adj[at]! * (data.symbols[symbol].currency === 'USD' ? data.usdcad[at] : 1);
            return { symbol, quantity: run.finalPositions[symbol], valueCad: round(valueCad, 2), weightPct: round((valueCad / final) * 100, 2) };
        }),
    };
}

const ASSUMPTIONS: StrategyTextKey[] = ['strat.assume.illustrative', 'strat.assume.execution', 'strat.assume.total_return', 'strat.assume.fx', 'strat.assume.fees', 'strat.assume.contributions', 'strat.assume.xray_difference'];

/**
 * Runs one replay on loaded data. `without`: the portfolio bought at the close of the first day and held. `with`:
 * the same purchase, then the strategy. Same capital, fee and data; with no rule the two series are identical.
 */
export function runReplayOn(data: ReplayData, params: ReplayParams): ReplayResult {
    const config: StrategyConfig = params.config ?? STRATEGY_CONFIG;
    const { strategy, capitalCad, feePerOrderCad } = params;
    const lastIndex = data.calendar.length - 1;
    const from = data.calendar.findIndex((date) => date >= params.startDate);
    if (from < 0 || from >= lastIndex) throw new ReplayError('window_too_short', `no two trading days on or after ${params.startDate} in snapshot ${data.snapshotId}`);
    const dates = data.calendar.slice(from);
    const replayId = replayIdOf(data.snapshotId, params);

    // What cannot be replayed is left out and listed, never patched
    const left: Unreplayable[] = [];
    const weights: Record<string, number> = {};
    let asked = 0;
    for (const { symbol, weightPct } of params.portfolio) {
        if (!(weightPct > 0)) continue;
        asked += weightPct;
        const why = whyNot(data, symbol, from);
        if (why) left.push(unreplayable(symbol, 'portfolio', why));
        else weights[symbol] = (weights[symbol] ?? 0) + weightPct;
    }
    const kept = Object.values(weights).reduce((sum, w) => sum + w, 0);
    if (!(kept > 0)) throw new ReplayError('nothing_to_replay', 'no holding of the portfolio can be replayed from this date');
    // The weights left are rescaled to the total that was asked for (at most 100)
    const scale = Math.min(asked, 100) / kept;
    for (const symbol of Object.keys(weights)) weights[symbol] *= scale;
    for (const symbol of strategySymbols(strategy)) {
        const why = whyNot(data, symbol, from);
        if (why && !left.some((u) => u.symbol === symbol)) left.push(unreplayable(symbol, 'rule', why));
    }

    const base = { replayId, from, weights, capitalCad, feePerOrderCad, config };
    const without = simulateSeries(data, { ...base, series: 'without', rules: [] });
    const withRules = (rules: StrategyRule[]) => simulateSeries(data, { ...base, series: 'with', rules });
    const withRun = withRules(strategy.rules);
    const series = { without: seriesResult(data, without, dates, capitalCad), with: seriesResult(data, withRun, dates, capitalCad) };

    // References, over the same days, with no fee
    const benchmark = (id: BenchmarkResult['id'], portfolio: PortfolioWeight[], rebalancing: BenchmarkResult['rebalancing']): BenchmarkResult => {
        const missing = portfolio.map((p) => ({ symbol: p.symbol, why: whyNot(data, p.symbol, from) })).find((x) => x.why);
        if (missing?.why) {
            if (!left.some((u) => u.symbol === missing.symbol && u.role === 'benchmark')) left.push(unreplayable(missing.symbol, 'benchmark', missing.why));
            return { id, weights: portfolio, rebalancing, available: false, reason: missing.why.reason, valueCad: [], index: [], metrics: null };
        }
        const rules: StrategyRule[] = rebalancing === 'quarterly' ? [{ kind: 'allocation_target', id: `benchmark_${id}`, version: 1, targets: portfolio.map((p) => ({ ...p })), rebalance: { mode: 'quarterly' } }] : [];
        const run = simulateSeries(data, { ...base, series: 'benchmark', weights: Object.fromEntries(portfolio.map((p) => [p.symbol, p.weightPct])), rules, feePerOrderCad: 0 });
        return { id, weights: portfolio, rebalancing, available: true, reason: null, valueCad: r2(run.valueCad), index: r4(run.index), metrics: seriesMetrics(run, dates) };
    };
    const benchmarks = [
        benchmark('XIU.TO', [{ symbol: 'XIU.TO', weightPct: 100 }], 'none'),
        benchmark('60_40', [{ symbol: 'XIU.TO', weightPct: 60 }, { symbol: 'XBB.TO', weightPct: 40 }], 'quarterly'),
    ];

    // Each rule's contribution: the strategy against the strategy without that rule alone
    const mw = series.with.metrics;
    const mo = series.without.metrics;
    const ruleContributions: RuleContribution[] = strategy.rules.map((rule) => {
        const other = seriesMetrics(withRules(strategy.rules.filter((r) => r.id !== rule.id)), dates);
        return {
            ruleId: rule.id,
            kind: rule.kind,
            finalValueDeltaCad: round(mw.valueExContributionsCad - other.valueExContributionsCad, 2),
            totalReturnDeltaPts: round(mw.totalReturnPct - other.totalReturnPct, 2),
            worstFallDeltaPts: round(mw.worstFall.pct - other.worstFall.pct, 2),
        };
    });

    const identical = withRun.valueCad.every((v, i) => v === without.valueCad[i]) && withRun.orders.length === without.orders.length;
    const summary: ReplaySummary = {
        endedHigher: mw.totalReturnPct > mo.totalReturnPct ? 'with' : mw.totalReturnPct < mo.totalReturnPct ? 'without' : 'equal',
        comparedOn: 'time_weighted_total_return',
        finalValueGapCad: round(mw.valueExContributionsCad - mo.valueExContributionsCad, 2),
        totalReturnGapPts: round(mw.totalReturnPct - mo.totalReturnPct, 2),
        worstFallGapPts: round(mw.worstFall.pct - mo.worstFall.pct, 2),
        volatilityGapPts: round(mw.volatilityPct - mo.volatilityPct, 2),
        feesGapCad: round(mw.feesCad - mo.feesCad, 2),
        firings: withRun.ruleStats.map((s) => ({ ruleId: s.ruleId, kind: s.kind, count: s.fired })),
        rulesNeverFired: withRun.ruleStats.filter((s) => s.fired === 0).map((s) => s.ruleId),
        identical,
    };

    return {
        replayId,
        engineVersion: ENGINE_VERSION,
        simulated: true,
        snapshotId: data.snapshotId,
        snapshotExtractedOn: data.extractedOn,
        ruleVersions: { strategyConfig: config.version, strategy: `${strategy.id}@${strategy.version}`, rules: Object.fromEntries(strategy.rules.map((rule) => [rule.id, rule.version])) },
        params: {
            requestedPortfolio: params.portfolio.map((p) => ({ symbol: p.symbol, weightPct: p.weightPct })),
            portfolio: Object.keys(weights).map((symbol) => ({ symbol, weightPct: round(weights[symbol], 4) })),
            capitalCad,
            requestedStartDate: params.startDate,
            feePerOrderCad,
            strategy,
            minOrderCad: config.minOrderCad,
            antiOscillationTradingDays: config.antiOscillationTradingDays,
            priority: [...config.priority],
        },
        window: { from: dates[0], to: dates[dates.length - 1], tradingDays: dates.length },
        dates,
        series,
        benchmarks,
        gap: {
            valueCad: withRun.valueCad.map((v, i) => round(v - withRun.contributedCad[i] - without.valueCad[i], 2)),
            indexPts: withRun.index.map((v, i) => round(v - without.index[i], 4)),
        },
        orders: [...without.orders, ...withRun.orders],
        ruleEvents: withRun.events,
        ruleStats: withRun.ruleStats,
        ruleContributions,
        summary,
        unreplayable: left,
        assumptions: ASSUMPTIONS.map((key) => {
            const sentenceRef = strategyRef(key, key === 'strat.assume.fees' ? { feeCad: feePerOrderCad } : {});
            return { id: key, sentenceRef, sentence: bothLanguages(sentenceRef) };
        }),
        limitations: data.limitations,
    };
}

// ---------------------------------------------------------------- sensitivity

/** One other threshold per rule: the same rule, a little looser. Returns the changed rule and what changed. */
export function thresholdVariant(rule: StrategyRule): { rule: StrategyRule; field: string; from: number | string; to: number | string } {
    switch (rule.kind) {
        case 'allocation_target':
            return rule.rebalance.mode === 'drift'
                ? { rule: { ...rule, rebalance: { mode: 'drift', driftPts: Math.min(50, rule.rebalance.driftPts * 2) } }, field: 'rebalance.driftPts', from: rule.rebalance.driftPts, to: Math.min(50, rule.rebalance.driftPts * 2) }
                : { rule: { ...rule, rebalance: { mode: 'drift', driftPts: 5 } }, field: 'rebalance', from: 'quarterly', to: 'drift 5' };
        case 'weight_cap': {
            const to = Math.min(100, rule.maxWeightPct + 5);
            return { rule: { ...rule, maxWeightPct: to }, field: 'maxWeightPct', from: rule.maxWeightPct, to };
        }
        case 'drawdown_guard': {
            const to = Math.min(90, round(rule.triggerDrawdownPct * 1.5, 2));
            return { rule: { ...rule, triggerDrawdownPct: to }, field: 'triggerDrawdownPct', from: rule.triggerDrawdownPct, to };
        }
        case 'periodic_purchase':
            return rule.every.unit === 'month'
                ? { rule: { ...rule, every: { unit: 'trading_days', n: 63 } }, field: 'every', from: 'month', to: '63 trading days' }
                : { rule: { ...rule, every: { unit: 'month' } }, field: 'every', from: `${rule.every.n} trading days`, to: 'month' };
        case 'price_threshold': {
            const to = round(rule.trigger.value * 1.05, 4);
            return { rule: { ...rule, trigger: { ...rule.trigger, value: to } }, field: 'trigger.value', from: rule.trigger.value, to };
        }
    }
}

/**
 * The same replay under other assumptions: three start dates (the one asked, then a quarter and a half of the way
 * through the window) and one other threshold per rule. Every variant is a full replay with its own id.
 */
export function runSensitivityOn(data: ReplayData, params: ReplayParams): { report: SensitivityReport; results: ReplayResult[] } {
    const base = runReplayOn(data, params);
    const lastIndex = data.calendar.length - 1;
    const from = data.calendar.indexOf(base.window.from);
    const results: ReplayResult[] = [base];
    const variants: SensitivityVariant[] = [];
    const add = (variant: SensitivityVariant['variant'], result: ReplayResult) => {
        if (!results.includes(result)) results.push(result);
        variants.push({ variant, replayId: result.replayId, window: result.window, summary: result.summary, metrics: { without: result.series.without.metrics, with: result.series.with.metrics } });
    };
    add({ type: 'base' }, base);
    for (const share of [0.25, 0.5]) {
        const at = from + Math.round((lastIndex - from) * share);
        if (at <= from || at >= lastIndex) continue;
        const startDate = data.calendar[at];
        try {
            add({ type: 'start_date', startDate }, runReplayOn(data, { ...params, startDate }));
        } catch (error) {
            if (!(error instanceof ReplayError)) throw error;
        }
    }
    const strategy: Strategy = params.strategy;
    for (const rule of strategy.rules) {
        const changed = thresholdVariant(rule);
        const rules = strategy.rules.map((r) => (r.id === rule.id ? changed.rule : r));
        add({ type: 'threshold', ruleId: rule.id, kind: rule.kind, field: changed.field, from: changed.from, to: changed.to }, runReplayOn(data, { ...params, strategy: { ...strategy, rules } }));
    }
    const gaps = variants.map((v) => v.summary.totalReturnGapPts);
    const falls = variants.map((v) => v.summary.worstFallGapPts);
    return {
        results,
        report: {
            baseReplayId: base.replayId,
            snapshotId: data.snapshotId,
            variants,
            tally: {
                variants: variants.length,
                withEndedHigher: variants.filter((v) => v.summary.endedHigher === 'with').length,
                withoutEndedHigher: variants.filter((v) => v.summary.endedHigher === 'without').length,
                equal: variants.filter((v) => v.summary.endedHigher === 'equal').length,
                totalReturnGapPts: { min: Math.min(...gaps), max: Math.max(...gaps) },
                worstFallGapPts: { min: Math.min(...falls), max: Math.max(...falls) },
            },
        },
    };
}
