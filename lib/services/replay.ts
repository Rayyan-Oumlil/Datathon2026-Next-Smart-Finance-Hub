// The time machine's service: validates a request, loads the frozen snapshot through the DataProvider (no network),
// runs the pure engine (lib/replay/engine) and keeps the result in memory under its replay id. Every run, and every
// variant of a sensitivity run, is written to the decision log with its replay id and snapshot id.

import { z } from 'zod';
import { getReplayProvider, type DataProvider } from '@/lib/replay';
import { ReplayError, loadReplayData, runReplayOn, runSensitivityOn, type PortfolioWeight, type ReplayData, type ReplayParams, type ReplayResult, type SensitivityReport } from '@/lib/replay/engine';
import { RULES_VERSION } from '@/lib/rules';
import { currentScope, type Scope } from '@/lib/session';
import { appendDecision } from '@/lib/store';
import { STRATEGY_CONFIG } from '@/lib/strategy/config';
import { strategyRef } from '@/lib/strategy/text';
import { parseStrategy, strategySymbols, type Strategy } from '@/lib/strategy/types';
import { ServiceError } from './errors';
import { getPortfolio } from './portfolio';
import { StrategyInvalidError, getStrategy } from './rules-engine';

const weightSchema = z.strictObject({ symbol: z.string().trim().toUpperCase().min(1).max(20), weightPct: z.number().positive().max(100) });

export const replayInputSchema = z.strictObject({
    /** The starting weights, or 'current' for the visitor's simulated portfolio as it stands. */
    portfolio: z.union([z.literal('current'), z.array(weightSchema).min(1).max(40)]),
    capitalCad: z.number().min(100).max(100_000_000),
    /** A strategy, the id of a stored one, or nothing (no rule: the two series are identical). */
    strategy: z.union([z.string().min(1).max(40), z.record(z.string(), z.unknown())]).nullish(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    feePerOrderCad: z.number().min(0).max(100).default(0),
});
export type RunReplayInput = z.input<typeof replayInputSchema>;

export type ReplayOptions = {
    /** Needed for 'current', for a stored strategy id and for the log; default: the request's session. */
    scope?: Scope;
    /** Default: getReplayProvider() (the frozen snapshot). Tests pass a fixture. */
    provider?: DataProvider;
};

const NO_RULES: Strategy = { id: 'none', name: '', rules: [], version: 1 };
const MAX_CACHED = 60;
const cacheHolder = globalThis as { __replayCache?: Map<string, ReplayResult> };
const cache = (): Map<string, ReplayResult> => (cacheHolder.__replayCache ??= new Map());

function remember(result: ReplayResult): ReplayResult {
    const store = cache();
    store.delete(result.replayId);
    store.set(result.replayId, result);
    while (store.size > MAX_CACHED) store.delete(store.keys().next().value as string);
    return result;
}

/** A replay run earlier in this process, by its id. */
export function getReplay(replayId: string): ReplayResult {
    const found = cache().get(replayId);
    if (!found) throw new ServiceError(404, strategyRef('strat.unknown_replay', { id: replayId }));
    return found;
}

export function resetReplayCache(): void {
    cache().clear();
}

async function scopeIfAny(given?: Scope): Promise<Scope | null> {
    if (given) return given;
    try {
        return await currentScope();
    } catch {
        return null;       // outside a request: nothing to log under
    }
}

/** The simulated portfolio as weights of its current value (cash keeps its share); at cost when a holding has no price. */
async function currentWeights(scope: Scope): Promise<PortfolioWeight[]> {
    const view = await getPortfolio(undefined, scope);
    const priced = view.positions.every((position) => position.valueCad !== null);
    const values = view.positions.map((position) => ({ symbol: position.symbol, valueCad: priced ? position.valueCad! : position.quantity * position.avgCostCad }));
    const total = view.cashCad + values.reduce((sum, v) => sum + v.valueCad, 0);
    const weights = values.filter((v) => v.valueCad > 0).map((v) => ({ symbol: v.symbol, weightPct: Math.round((v.valueCad / total) * 1e6) / 1e4 }));
    if (weights.length === 0) throw new ServiceError(400, strategyRef('strat.replay.empty_portfolio'));
    return weights;
}

async function prepare(input: unknown, options: ReplayOptions): Promise<{ data: ReplayData; params: ReplayParams; scope: Scope | null }> {
    const parsed = replayInputSchema.parse(input);
    const scope = await scopeIfAny(options.scope);
    let strategy = NO_RULES;
    if (typeof parsed.strategy === 'string') strategy = await getStrategy(parsed.strategy, scope ?? undefined);
    else if (parsed.strategy) {
        // A stored strategy sent back whole carries its storage dates: they are not part of the strategy itself
        const given = { ...parsed.strategy };
        for (const key of ['createdAt', 'updatedAt', 'peakValueCad']) delete given[key];
        const checked = parseStrategy(given);
        if (!checked.ok) throw new StrategyInvalidError(checked.errors);
        strategy = checked.strategy;
    }
    const portfolio = parsed.portfolio === 'current' ? await currentWeights(scope ?? await currentScope()) : parsed.portfolio;
    const total = portfolio.reduce((sum, p) => sum + p.weightPct, 0);
    if (total > 100 + 1e-6) throw new ServiceError(400, strategyRef('strat.replay.weights_over_100', { total }));
    const symbols = [...new Set([...portfolio.map((p) => p.symbol), ...strategySymbols(strategy)])];
    const data = await loadReplayData(options.provider ?? getReplayProvider(), symbols);
    return { data, params: { portfolio, capitalCad: parsed.capitalCad, strategy, startDate: parsed.startDate, feePerOrderCad: parsed.feePerOrderCad }, scope };
}

function asServiceError(error: unknown): unknown {
    if (!(error instanceof ReplayError) || error.code === 'invariant') return error;
    return new ServiceError(400, strategyRef(error.code === 'window_too_short' ? 'strat.replay.window_too_short' : 'strat.replay.nothing_to_replay'));
}

const logRun = (scope: Scope | null, payload: Record<string, unknown>, snapshotId: string) =>
    scope
        ? appendDecision({ userId: scope.scopeId, kind: 'replay_run', snapshotId, ruleVersions: { rules: RULES_VERSION, strategy: STRATEGY_CONFIG.version }, payload: { origin: 'replay', simulated: true, ...payload } }).catch(() => undefined)
        : Promise.resolve(undefined);

const logged = (result: ReplayResult) => ({
    replayId: result.replayId,
    snapshotId: result.snapshotId,
    strategy: result.ruleVersions.strategy,
    ruleVersions: result.ruleVersions.rules,
    startDate: result.params.requestedStartDate,
    window: result.window,
    capitalCad: result.params.capitalCad,
    feePerOrderCad: result.params.feePerOrderCad,
    portfolio: result.params.portfolio,
    summary: result.summary,
});

/**
 * Replays a portfolio on the frozen snapshot, without and with a strategy. Same inputs, same replay id, same result
 * (served from memory the second time). Throws ServiceError 400 on a bad request, StrategyInvalidError on a bad strategy.
 */
export async function runReplay(input: RunReplayInput, options: ReplayOptions = {}): Promise<ReplayResult> {
    const { data, params, scope } = await prepare(input, options);
    try {
        const result = remember(runReplayOn(data, params));
        await logRun(scope, { run: 'replay', ...logged(result) }, result.snapshotId);
        return result;
    } catch (error) {
        throw asServiceError(error);
    }
}

/** The same replay from three start dates and with one other threshold per rule. Each variant is cached and logged under its own replay id. */
export async function runSensitivity(input: RunReplayInput, options: ReplayOptions = {}): Promise<SensitivityReport> {
    const { data, params, scope } = await prepare(input, options);
    try {
        const { report, results } = runSensitivityOn(data, params);
        results.forEach(remember);
        await logRun(scope, { run: 'sensitivity', baseReplayId: report.baseReplayId, variants: report.variants.map((v) => ({ variant: v.variant, replayId: v.replayId, window: v.window, summary: v.summary })), tally: report.tally }, report.snapshotId);
        return report;
    } catch (error) {
        throw asServiceError(error);
    }
}

export type ReplayDigest = Pick<ReplayResult, 'replayId' | 'snapshotId' | 'simulated' | 'window' | 'ruleVersions' | 'summary' | 'ruleStats' | 'ruleContributions'> & {
    metrics: { without: ReplayResult['series']['without']['metrics']; with: ReplayResult['series']['with']['metrics'] };
    effects: { without: ReplayResult['series']['without']['effects']; with: ReplayResult['series']['with']['effects'] };
    benchmarks: Array<{ id: string; available: boolean; totalReturnPct: number | null; worstFallPct: number | null; volatilityPct: number | null }>;
    unreplayable: Array<{ symbol: string; role: string; reason: string }>;
    /** The first rule events, as their deterministic sentences in `locale`. */
    firstEvents: string[];
    eventCount: number;
};

/** A replay without its daily series and journal (a few KB instead of several hundred): what the agent tool reads. */
export function replayDigest(result: ReplayResult, locale: 'fr' | 'en' = 'fr', maxEvents = 12): ReplayDigest {
    return {
        replayId: result.replayId,
        snapshotId: result.snapshotId,
        simulated: true,
        window: result.window,
        ruleVersions: result.ruleVersions,
        summary: result.summary,
        ruleStats: result.ruleStats,
        ruleContributions: result.ruleContributions,
        metrics: { without: result.series.without.metrics, with: result.series.with.metrics },
        effects: { without: result.series.without.effects, with: result.series.with.effects },
        benchmarks: result.benchmarks.map((b) => ({ id: b.id, available: b.available, totalReturnPct: b.metrics?.totalReturnPct ?? null, worstFallPct: b.metrics?.worstFall.pct ?? null, volatilityPct: b.metrics?.volatilityPct ?? null })),
        unreplayable: result.unreplayable.map((u) => ({ symbol: u.symbol, role: u.role, reason: u.reason })),
        firstEvents: result.ruleEvents.slice(0, maxEvents).map((event) => event.sentence[locale]),
        eventCount: result.ruleEvents.length,
    };
}
