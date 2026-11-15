// The X-ray engine: today's shares, then, for each window, a constant-weights replay of the portfolio (today's
// proportions applied to every past day) and the statistics of it. Pure; the service feeds it the series.

import type { DailyClose } from '@/lib/sources/types';
import { calendarKindOf, commonCalendar, levelsOn, periodsPerYearOf, toCadCloses } from './align';
import {
    annualVolPct, curveOf, diversificationRatio, maxDrawdownOf, returnsOf, riskShares, round, thin, topPairs, worstDayOf, worstSpanOf,
} from './stats';
import { WINDOW_IDS, type Concentration, type CoverageGap, type EngineHolding, type GapReason, type EngineInput, type EngineOutput, type HoldingShare, type WindowId, type WindowResult } from './types';
import { addDays, EDGE_TOLERANCE_DAYS, MIN_RETURNS, windowBounds } from './windows';

const CHART_POINTS = 150;
const PAIRS_SHOWN = 3;

type Prepared = { holding: EngineHolding; closes: DailyClose[] };

const pct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);

function aggregate(rows: Array<{ name: string; value: number }>, total: number) {
    const sums = new Map<string, number>();
    for (const row of rows) sums.set(row.name, (sums.get(row.name) ?? 0) + row.value);
    return [...sums.entries()].map(([name, value]) => ({ name, sharePct: round(pct(value, total), 2) })).sort((a, b) => b.sharePct - a.sharePct);
}

function concentrationOf(holdings: EngineHolding[], cashCad: number, total: number): Concentration {
    const sorted = [...holdings].sort((a, b) => b.valueCad - a.valueCad);
    const invested = holdings.reduce((sum, h) => sum + h.valueCad, 0);
    const squares = holdings.reduce((sum, h) => sum + (h.valueCad / invested) ** 2, 0);
    return {
        topHolding: sorted.length > 0 ? { symbol: sorted[0].symbol, sharePct: round(pct(sorted[0].valueCad, total), 2) } : null,
        top3SharePct: round(pct(sorted.slice(0, 3).reduce((sum, h) => sum + h.valueCad, 0), total), 2),
        effectiveHoldings: invested > 0 ? round(1 / squares, 2) : null,
        groups: aggregate(holdings.map((h) => ({ name: h.group, value: h.valueCad })), total),
        assetClasses: aggregate(holdings.map((h) => ({ name: h.assetClass, value: h.valueCad })), total),
        // Cash is Canadian dollars
        currencies: aggregate([...holdings.map((h) => ({ name: h.currency, value: h.valueCad })), { name: 'CAD', value: cashCad }], total),
    };
}

function unavailable(id: WindowId, reason: 'no_holdings' | 'not_enough_history'): WindowResult {
    return { id, available: false, reason };
}

const covers = (closes: DailyClose[], start: string, end: string) =>
    closes[0].date <= addDays(start, EDGE_TOLERANCE_DAYS) && closes[closes.length - 1].date >= addDays(end, -EDGE_TOLERANCE_DAYS);

const gap = (symbol: string, reason: GapReason, closes: DailyClose[] | null): CoverageGap => ({
    symbol, reason, firstDate: closes?.[0]?.date ?? null, lastDate: closes?.[closes.length - 1]?.date ?? null,
});

/** Why a prepared series is not in the window [start, end]. */
const gapOf = ({ holding, closes }: Prepared, start: string): CoverageGap =>
    gap(holding.symbol, closes[0].date > addDays(start, EDGE_TOLERANCE_DAYS) ? 'starts_later' : 'ends_earlier', closes);

/**
 * One scenario of holdings: what it holds with history, what it holds without, its cash and its total value. The
 * replay reads only this, so the X-ray and both sides of a what-if go through the same code.
 */
type Scenario = { prepared: Prepared[]; missing: EngineHolding[]; holdingCount: number; cashCad: number; total: number };

/**
 * The replay of `covering` (series that reach over [start, end]) on the calendar of `calendarSeries` (by default the
 * same series). `gaps` names every held symbol left out and why. Unavailable with fewer than MIN_RETURNS returns.
 */
function replayOver(
    id: WindowId, covering: Prepared[], gaps: CoverageGap[], scenario: Scenario, start: string, end: string, calendarSeries: Prepared[] = covering,
): WindowResult {
    if (covering.length === 0) return unavailable(id, 'not_enough_history');
    const clip = (closes: DailyClose[]) => closes.filter((row) => row.date >= start && row.date <= end);
    const inRange = covering.map(({ holding, closes }) => ({ holding, closes: clip(closes) }));
    const calendarRange = calendarSeries.map(({ holding, closes }) => ({ isCrypto: holding.isCrypto, closes: clip(closes) }));
    const firstDay = calendarRange.reduce((latestStart, { closes }) => (closes[0] && closes[0].date > latestStart ? closes[0].date : latestStart), '');
    const dates = commonCalendar(calendarRange).filter((date) => date >= firstDay);
    if (dates.length < MIN_RETURNS + 1) return unavailable(id, 'not_enough_history');

    const perYear = periodsPerYearOf(dates);
    const levels = inRange.map(({ closes }) => levelsOn(closes, dates) as number[]);
    const returns = levels.map(returnsOf);
    const investedValue = inRange.reduce((sum, { holding }) => sum + holding.valueCad, 0);
    const base = scenario.cashCad + investedValue;
    const weights = inRange.map(({ holding }) => holding.valueCad / base);
    const portfolioReturns = dates.slice(1).map((_, t) => weights.reduce((sum, w, i) => sum + w * returns[i][t], 0));

    const curve = curveOf(dates, portfolioReturns);
    const maxDrawdown = maxDrawdownOf(curve);
    const shares = riskShares(weights, returns, portfolioReturns);
    const symbols = inRange.map(({ holding }) => holding.symbol);
    const ratio = diversificationRatio(weights, returns, portfolioReturns);

    return {
        id,
        available: true,
        from: dates[0],
        to: dates[dates.length - 1],
        observations: portfolioReturns.length,
        calendar: calendarKindOf(perYear),
        periodsPerYear: round(perYear, 1),
        coverage: {
            sharePct: round(pct(base, scenario.total), 2),
            included: symbols,
            excluded: gaps.map((g) => g.symbol),
            gaps,
        },
        volatilityPct: round(annualVolPct(portfolioReturns, perYear), 2),
        maxDrawdown,
        worstDay: worstDayOf(dates, portfolioReturns),
        worstSpan20: worstSpanOf(curve, 20),
        diversificationRatio: ratio === null ? null : round(ratio, 2),
        risk: inRange.map(({ holding }, i) => ({
            symbol: holding.symbol,
            weightPct: round(weights[i] * 100, 2),
            volatilityPct: round(annualVolPct(returns[i], perYear), 2),
            riskSharePct: shares[i] === null ? null : round(shares[i]!, 2),
        })).sort((a, b) => b.weightPct - a.weightPct),
        pairs: topPairs(symbols, returns, PAIRS_SHOWN),
        curve: thin(curve, CHART_POINTS, [maxDrawdown.peakDate, maxDrawdown.troughDate]).map((point) => ({ date: point.date, value: round(point.value, 2) })),
    };
}

/** The X-ray's own windows: each runs over the history of the held series, and a series that does not reach over it is left out, named. */
function replay(id: WindowId, scenario: Scenario, earliest: string, latest: string): WindowResult {
    if (scenario.holdingCount === 0) return unavailable(id, 'no_holdings');
    const { start, end } = windowBounds(id, earliest, latest);
    const covering = scenario.prepared.filter(({ closes }) => covers(closes, start, end));
    const gaps = [
        ...scenario.prepared.filter((p) => !covering.includes(p)).map((p) => gapOf(p, start)),
        ...scenario.missing.map((h) => gap(h.symbol, 'no_history', null)),
    ];
    return replayOver(id, covering, gaps, scenario, start, end);
}

function prepare(holdings: EngineHolding[], cashCad: number, fx: EngineInput['fx']): Scenario {
    const prepared: Prepared[] = [];
    const missing: EngineHolding[] = [];
    for (const holding of holdings) {
        const closes = holding.closes ? toCadCloses(holding.closes, holding.currency, fx) : [];
        if (closes.length === 0) missing.push(holding);
        else prepared.push({ holding, closes });
    }
    return { prepared, missing, holdingCount: holdings.length, cashCad, total: cashCad + holdings.reduce((sum, h) => sum + h.valueCad, 0) };
}

/** Everything but the windows: shares, concentration, holdings with no history. */
function summarise(input: EngineInput, scenario: Scenario, windows: Record<WindowId, WindowResult>): EngineOutput {
    const { holdings, cashCad } = input;
    const total = scenario.total;
    const shares: HoldingShare[] = holdings
        .map((h) => ({ symbol: h.symbol, name: h.name, group: h.group, assetClass: h.assetClass, currency: h.currency, valueCad: round(h.valueCad, 2), sharePct: round(pct(h.valueCad, total), 2) }))
        .sort((a, b) => b.valueCad - a.valueCad);
    return {
        holdings: shares,
        cashCad: round(cashCad, 2),
        cashSharePct: round(pct(cashCad, total), 2),
        totalValueCad: round(total, 2),
        concentration: concentrationOf(holdings, cashCad, total),
        windows,
        noHistory: scenario.missing.map((h) => h.symbol),
    };
}

/**
 * A what-if: the portfolio before and after a change in `changed`, each window computed over the SAME dates for both
 * sides and the SAME covered symbols. The common window starts at the latest first close among the holdings of both
 * scenarios (so an asset with a short history shortens both sides alike, rather than being left out of one); a
 * series too short for MIN_RETURNS, or that ends early, is left out of both, named with its reason. When the changed
 * asset itself is not covered, the after side is unavailable with that reason rather than computed without it.
 */
export function computeComparison(before: EngineInput, after: EngineInput, changed: string): { before: EngineOutput; after: EngineOutput } {
    const fx = before.fx;
    const sides = [prepare(before.holdings, before.cashCad, fx), prepare(after.holdings, after.cashCad, fx)] as const;
    // One series per symbol (both sides read the same closes); the value comes from each side
    const series = new Map<string, Prepared>();
    for (const side of sides) for (const p of side.prepared) if (!series.has(p.holding.symbol)) series.set(p.holding.symbol, p);
    const all = [...series.values()];
    const latest = all.reduce((max, { closes }) => (closes[closes.length - 1].date > max ? closes[closes.length - 1].date : max), '0000-01-01');

    const windowsOf = (sideIndex: 0 | 1) => Object.fromEntries(WINDOW_IDS.map((id) => {
        const side = sides[sideIndex];
        if (side.holdingCount === 0) return [id, unavailable(id, 'no_holdings')];
        // A series with too few closes up to the end would shrink the common window below the minimum: left out of both sides
        const longEnough = all.filter(({ closes }) => closes.filter((row) => row.date <= latest).length >= MIN_RETURNS + 1);
        const commonStart = longEnough.reduce((max, { closes }) => (closes[0].date > max ? closes[0].date : max), '0000-01-01');
        const { start, end } = windowBounds(id, commonStart, latest);
        const covering = longEnough.filter(({ closes }) => covers(closes, start, end));
        const coveredSymbols = new Set(covering.map((p) => p.holding.symbol));

        const reasonFor = (symbol: string): CoverageGap => {
            const p = series.get(symbol);
            if (!p) return gap(symbol, 'no_history', null);
            if (!longEnough.includes(p)) return gap(symbol, 'not_enough_history', p.closes);
            return gapOf(p, start);
        };
        if (sideIndex === 1 && !coveredSymbols.has(changed)) {
            return [id, { id, available: false, reason: 'changed_asset_no_history', gap: reasonFor(changed) } satisfies WindowResult];
        }
        const held = side.prepared.filter((p) => coveredSymbols.has(p.holding.symbol));
        const gaps = [
            ...side.prepared.filter((p) => !coveredSymbols.has(p.holding.symbol)).map((p) => reasonFor(p.holding.symbol)),
            ...side.missing.map((h) => gap(h.symbol, 'no_history', null)),
        ];
        // The calendar is that of every covered series of both sides, so before and after are read on the same days
        return [id, replayOver(id, held, gaps, side, start, end, covering)];
    })) as Record<WindowId, WindowResult>;

    return { before: summarise(before, sides[0], windowsOf(0)), after: summarise(after, sides[1], windowsOf(1)) };
}

export function computeEngine(input: EngineInput): EngineOutput {
    const scenario = prepare(input.holdings, input.cashCad, input.fx);
    const { prepared } = scenario;
    const earliest = prepared.reduce((min, { closes }) => (closes[0].date < min ? closes[0].date : min), '9999-12-31');
    const latest = prepared.reduce((max, { closes }) => (closes[closes.length - 1].date > max ? closes[closes.length - 1].date : max), '0000-01-01');
    const windows = Object.fromEntries(WINDOW_IDS.map((id) => [
        id,
        prepared.length === 0
            ? unavailable(id, input.holdings.length === 0 ? 'no_holdings' : 'not_enough_history')
            : replay(id, scenario, earliest, latest),
    ])) as Record<WindowId, WindowResult>;
    return summarise(input, scenario, windows);
}
