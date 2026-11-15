// The X-ray engine: today's shares, then, for each window, a constant-weights replay of the portfolio (today's
// proportions applied to every past day) and the statistics of it. Pure; the service feeds it the series.

import type { DailyClose } from '@/lib/sources/types';
import { commonCalendar, levelsOn, toCadCloses } from './align';
import {
    annualVolPct, curveOf, diversificationRatio, maxDrawdownOf, returnsOf, riskShares, round, thin, topPairs, worstDayOf, worstSpanOf,
} from './stats';
import { WINDOW_IDS, type Concentration, type EngineHolding, type EngineInput, type EngineOutput, type HoldingShare, type WindowId, type WindowResult } from './types';
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

function replay(id: WindowId, prepared: Prepared[], all: number, cashCad: number, total: number, earliest: string, latest: string): WindowResult {
    if (all === 0) return unavailable(id, 'no_holdings');
    const { start, end } = windowBounds(id, earliest, latest);
    const covering = prepared.filter(({ closes }) =>
        closes[0].date <= addDays(start, EDGE_TOLERANCE_DAYS) && closes[closes.length - 1].date >= addDays(end, -EDGE_TOLERANCE_DAYS));
    if (covering.length === 0) return unavailable(id, 'not_enough_history');

    const inRange = covering.map(({ holding, closes }) => ({ holding, closes: closes.filter((row) => row.date >= start && row.date <= end) }));
    const firstDay = inRange.reduce((latestStart, { closes }) => (closes[0] && closes[0].date > latestStart ? closes[0].date : latestStart), '');
    const dates = commonCalendar(inRange.map(({ holding, closes }) => ({ isCrypto: holding.isCrypto, closes }))).filter((date) => date >= firstDay);
    if (dates.length < MIN_RETURNS + 1) return unavailable(id, 'not_enough_history');

    const levels = inRange.map(({ closes }) => levelsOn(closes, dates) as number[]);
    const returns = levels.map(returnsOf);
    const investedValue = inRange.reduce((sum, { holding }) => sum + holding.valueCad, 0);
    const base = cashCad + investedValue;
    const weights = inRange.map(({ holding }) => holding.valueCad / base);
    const portfolioReturns = dates.slice(1).map((_, t) => weights.reduce((sum, w, i) => sum + w * returns[i][t], 0));

    const curve = curveOf(dates, portfolioReturns);
    const maxDrawdown = maxDrawdownOf(curve);
    const shares = riskShares(weights, returns, portfolioReturns);
    const symbols = inRange.map(({ holding }) => holding.symbol);
    const included = new Set(symbols);
    const ratio = diversificationRatio(weights, returns, portfolioReturns);

    return {
        id,
        available: true,
        from: dates[0],
        to: dates[dates.length - 1],
        observations: portfolioReturns.length,
        coverage: {
            sharePct: round(pct(base, total), 2),
            included: symbols,
            excluded: prepared.map(({ holding }) => holding.symbol).filter((symbol) => !included.has(symbol)),
        },
        volatilityPct: round(annualVolPct(portfolioReturns), 2),
        maxDrawdown,
        worstDay: worstDayOf(dates, portfolioReturns),
        worstSpan20: worstSpanOf(curve, 20),
        diversificationRatio: ratio === null ? null : round(ratio, 2),
        risk: inRange.map(({ holding }, i) => ({
            symbol: holding.symbol,
            weightPct: round(weights[i] * 100, 2),
            volatilityPct: round(annualVolPct(returns[i]), 2),
            riskSharePct: shares[i] === null ? null : round(shares[i]!, 2),
        })).sort((a, b) => b.weightPct - a.weightPct),
        pairs: topPairs(symbols, returns, PAIRS_SHOWN),
        curve: thin(curve, CHART_POINTS, [maxDrawdown.peakDate, maxDrawdown.troughDate]).map((point) => ({ date: point.date, value: round(point.value, 2) })),
    };
}

export function computeEngine(input: EngineInput): EngineOutput {
    const { holdings, cashCad, fx } = input;
    const total = cashCad + holdings.reduce((sum, h) => sum + h.valueCad, 0);

    const noHistory: string[] = [];
    const prepared: Prepared[] = [];
    for (const holding of holdings) {
        const closes = holding.closes ? toCadCloses(holding.closes, holding.currency, fx) : [];
        if (closes.length === 0) noHistory.push(holding.symbol);
        else prepared.push({ holding, closes });
    }

    const earliest = prepared.reduce((min, { closes }) => (closes[0].date < min ? closes[0].date : min), '9999-12-31');
    const latest = prepared.reduce((max, { closes }) => (closes[closes.length - 1].date > max ? closes[closes.length - 1].date : max), '0000-01-01');
    const windows = Object.fromEntries(WINDOW_IDS.map((id) => [
        id,
        prepared.length === 0
            ? unavailable(id, holdings.length === 0 ? 'no_holdings' : 'not_enough_history')
            : replay(id, prepared, holdings.length, cashCad, total, earliest, latest),
    ])) as Record<WindowId, WindowResult>;

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
        noHistory,
    };
}
