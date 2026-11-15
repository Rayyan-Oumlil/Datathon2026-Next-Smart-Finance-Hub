// Shapes of the replay engine: what it reads (ReplayData, built once from the DataProvider) and what it returns
// (ReplayResult). Everything is plain JSON, so a result can be cached, logged and sent to the UI as is.

import type { TextRef } from '@/lib/domain/types';
import type { StrategyConfig } from '@/lib/strategy/config';
import type { DropReason, OrderAdjustment, OrderPurpose, ProposedOrder, RuleCondition, SkipReason } from '@/lib/strategy/evaluate';
import type { Sentence } from '@/lib/strategy/sentence';
import type { RuleKind, Strategy } from '@/lib/strategy/types';
import type { Drawdown } from '@/lib/xray/types';
import type { DataNote, IsoDate, ListingCurrency } from '../types';

// ---------------------------------------------------------------- input

/** One symbol on the common calendar. `adj` is the adjusted close (total return), `close` the unadjusted one; null before the first known price. */
export type ReplaySymbolData = {
    currency: ListingCurrency;
    adj: Array<number | null>;
    close: Array<number | null>;
    firstDate: IsoDate | null;
    lastDate: IsoDate | null;
};

/** Everything a replay reads, loaded once from the provider (lib/replay/engine/data.ts). No network after this. */
export type ReplayData = {
    snapshotId: string;
    extractedOn: IsoDate;
    /** The common calendar of the snapshot, ascending. */
    calendar: IsoDate[];
    symbols: Record<string, ReplaySymbolData>;
    /** CAD per USD on each calendar date (the last known rate when the day has none). */
    usdcad: number[];
    /** Symbols asked for that the snapshot does not hold. */
    missing: string[];
    limitations: DataNote[];
};

export type PortfolioWeight = { symbol: string; weightPct: number };

export type ReplayParams = {
    portfolio: PortfolioWeight[];
    capitalCad: number;
    strategy: Strategy;
    startDate: IsoDate;
    feePerOrderCad: number;
    /** Default: the `strategy` block of rules/v1.json. */
    config?: StrategyConfig;
};

// ---------------------------------------------------------------- output

export type SeriesName = 'without' | 'with';

/** One filled order of a replay. A separate space from the live simulated trades: origin is always 'replay'. */
export type ReplayOrder = {
    id: string;
    origin: 'replay';
    replayId: string;
    snapshotId: string;
    series: SeriesName | 'benchmark';
    /** null for the starting purchase. */
    ruleId: string | null;
    ruleVersion: number | null;
    purpose: OrderPurpose | 'initial';
    decisionDay: IsoDate;
    executionDay: IsoDate;
    symbol: string;
    side: 'buy' | 'sell';
    quantity: number;
    /** Adjusted close of the execution day, listing currency. */
    price: number;
    currency: ListingCurrency;
    /** USD/CAD used; null for a CAD listing. */
    usdcad: number | null;
    priceCad: number;
    valueCad: number;
    feeCad: number;
    /** Portfolio value just before and just after the order, at the prices of the execution day (they differ by the fee). */
    valueBeforeCad: number;
    valueAfterCad: number;
    cashAfterCad: number;
    adjustment?: OrderAdjustment;
    sentenceRef: TextRef;
    sentence: Sentence;
};

export type NotPlaced = { symbol: string; side: 'buy' | 'sell'; valueCad: number; reason: DropReason; at: 'decision' | 'execution'; sentenceRef: TextRef; sentence: Sentence };

export type ReplayRuleEvent = {
    series: SeriesName;
    ruleId: string;
    ruleVersion: number;
    kind: RuleKind;
    decisionDay: IsoDate;
    executionDay: IsoDate;
    /** The numbers the condition was tested on at the close of the decision day. */
    condition: RuleCondition;
    /** The orders as decided at the close of the decision day (sizes at that day's prices), before they were filled. */
    proposedOrders: ProposedOrder[];
    orderIds: string[];
    notPlaced: NotPlaced[];
    contributionCad: number;
    guard: 'entered' | 'exited' | null;
    /** Portfolio value at the close of the decision day and at the close of the execution day. */
    valueAtDecisionCad: number;
    valueAfterExecutionCad: number;
    sentenceRef: TextRef;
    sentence: Sentence;
};

export type SeriesMetrics = {
    finalValueCad: number;
    /** New cash added by periodic purchases; 0 without such a rule. */
    contributedCad: number;
    /** finalValueCad - contributedCad. */
    valueExContributionsCad: number;
    /** Time-weighted: the growth of each dollar invested, contributions excluded. */
    totalReturnPct: number;
    /** null when the replay covers less than one year. */
    annualisedReturnPct: number | null;
    volatilityPct: number;
    worstFall: Drawdown;
    /** Calendar 2022; null when the replay does not cover the whole year. */
    return2022Pct: number | null;
    worstDay: { pct: number; date: IsoDate };
    /** Orders placed by rules (the starting purchase is counted apart). */
    orderCount: number;
    initialOrderCount: number;
    /** Value traded by rules / average portfolio value, in percent. */
    turnoverPct: number;
    feesCad: number;
};

/** final value - starting capital = market + currency - fees + contributed (exact identity, checked by the engine). */
export type Effects = { marketCad: number; currencyCad: number; feesCad: number; contributedCad: number; marketPct: number; currencyPct: number };

export type SeriesResult = {
    valueCad: number[];
    cashCad: number[];
    contributedCad: number[];
    /** Time-weighted index, 100 = the starting capital. */
    index: number[];
    metrics: SeriesMetrics;
    effects: Effects;
    finalPositions: Array<{ symbol: string; quantity: number; valueCad: number; weightPct: number }>;
};

export type BenchmarkResult = {
    id: 'XIU.TO' | '60_40';
    weights: PortfolioWeight[];
    rebalancing: 'none' | 'quarterly';
    available: boolean;
    /** Why it is missing, when it is. */
    reason: UnreplayableReason | null;
    valueCad: number[];
    index: number[];
    metrics: SeriesMetrics | null;
};

export type UnreplayableReason = 'not_in_snapshot' | 'starts_later' | 'ends_earlier';
export type Unreplayable = { symbol: string; role: 'portfolio' | 'rule' | 'benchmark'; reason: UnreplayableReason; date: IsoDate | null; sentenceRef: TextRef; sentence: Sentence };

export type RuleStat = { ruleId: string; kind: RuleKind; version: number; fired: number; skipped: Partial<Record<SkipReason, number>> };

/** What removing one rule alone changes: `with` minus (`with` without that rule). */
export type RuleContribution = { ruleId: string; kind: RuleKind; finalValueDeltaCad: number; totalReturnDeltaPts: number; worstFallDeltaPts: number };

/** Neutral facts, never a verdict. Gaps are `with` minus `without`. */
export type ReplaySummary = {
    /** Which series ended higher, on the time-weighted total return. Not a winner: a higher end can come with a deeper fall. */
    endedHigher: SeriesName | 'equal';
    comparedOn: 'time_weighted_total_return';
    finalValueGapCad: number;
    totalReturnGapPts: number;
    /** Positive: the worst fall with the strategy was shallower. */
    worstFallGapPts: number;
    volatilityGapPts: number;
    feesGapCad: number;
    firings: Array<{ ruleId: string; kind: RuleKind; count: number }>;
    rulesNeverFired: string[];
    identical: boolean;
};

export type ReplayResult = {
    replayId: string;
    engineVersion: string;
    simulated: true;
    snapshotId: string;
    snapshotExtractedOn: IsoDate;
    ruleVersions: { strategyConfig: string; strategy: string; rules: Record<string, number> };
    params: {
        requestedPortfolio: PortfolioWeight[];
        /** After leaving out what could not be replayed (weights rescaled to the same total). */
        portfolio: PortfolioWeight[];
        capitalCad: number;
        requestedStartDate: IsoDate;
        feePerOrderCad: number;
        strategy: Strategy;
        minOrderCad: number;
        antiOscillationTradingDays: number;
        priority: RuleKind[];
    };
    window: { from: IsoDate; to: IsoDate; tradingDays: number };
    dates: IsoDate[];
    series: Record<SeriesName, SeriesResult>;
    benchmarks: BenchmarkResult[];
    /** `with` minus `without`, day by day: in CAD (contributions excluded) and in index points. */
    gap: { valueCad: number[]; indexPts: number[] };
    orders: ReplayOrder[];
    ruleEvents: ReplayRuleEvent[];
    ruleStats: RuleStat[];
    ruleContributions: RuleContribution[];
    summary: ReplaySummary;
    unreplayable: Unreplayable[];
    assumptions: Array<{ id: string; sentenceRef: TextRef; sentence: Sentence }>;
    /** From the data provider's describe(): shown next to every replay (keys of the next-intl Replay namespace). */
    limitations: DataNote[];
};

export type SensitivityVariant = {
    variant: { type: 'base' } | { type: 'start_date'; startDate: IsoDate } | { type: 'threshold'; ruleId: string; kind: RuleKind; field: string; from: number | string; to: number | string };
    replayId: string;
    window: { from: IsoDate; to: IsoDate; tradingDays: number };
    summary: ReplaySummary;
    metrics: Record<SeriesName, SeriesMetrics>;
};

export type SensitivityReport = {
    baseReplayId: string;
    snapshotId: string;
    variants: SensitivityVariant[];
    /** In how many of the variants each series ended higher, and the range of the gaps: facts, no verdict. */
    tally: { variants: number; withEndedHigher: number; withoutEndedHigher: number; equal: number; totalReturnGapPts: { min: number; max: number }; worstFallGapPts: { min: number; max: number } };
};

export class ReplayError extends Error {
    constructor(public code: 'window_too_short' | 'nothing_to_replay' | 'invariant', message: string) {
        super(message);
        this.name = 'ReplayError';
    }
}
