// Shapes of the portfolio X-ray (method xray-v1, docs/superpowers/specs/2026-11-15-portfolio-xray-design.md).
// Percent fields are numbers in percent (31.24 means 31.24 %), rounded for display; correlations are coefficients.

import type { DailyClose } from '@/lib/sources/types';

export const XRAY_VERSION = 'xray-v1';

export const WINDOW_IDS = ['full', 'last3y', 'last1y'] as const;
export type WindowId = (typeof WINDOW_IDS)[number];

/** One holding as the engine reads it: its value now, and its daily closes in the listing currency (null: none). */
export type EngineHolding = {
    symbol: string;
    name: string;
    group: string;               // sector, or ETF / Crypto / Other, in the request's language
    assetClass: string;
    currency: string;            // listing currency of the closes
    valueCad: number;
    isCrypto: boolean;
    closes: DailyClose[] | null;
};

export type EngineInput = { holdings: EngineHolding[]; cashCad: number; fx: Array<{ date: string; rate: number }> };

export type HoldingShare = { symbol: string; name: string; group: string; assetClass: string; currency: string; valueCad: number; sharePct: number };

export type Concentration = {
    topHolding: { symbol: string; sharePct: number } | null;
    top3SharePct: number;                        // of the whole portfolio, cash included
    effectiveHoldings: number | null;            // 1 / sum of squared shares of the invested part
    groups: Array<{ name: string; sharePct: number }>;
    assetClasses: Array<{ name: string; sharePct: number }>;
    currencies: Array<{ name: string; sharePct: number }>;
};

export type Drawdown = { pct: number; peakDate: string; troughDate: string; recoveredDate: string | null };

export type WindowRisk = { symbol: string; weightPct: number; volatilityPct: number; riskSharePct: number | null };

/**
 * Why a held symbol is not in a replay: it has no usable daily closes at all, its history starts after the window's
 * start or ends before its end, or (what-if) it is too short to be compared over a common window.
 */
export type GapReason = 'no_history' | 'starts_later' | 'ends_earlier' | 'not_enough_history';
export type CoverageGap = { symbol: string; reason: GapReason; firstDate: string | null; lastDate: string | null };

/** What a replay covers: share of the portfolio's value (cash included), the symbols in it, and those left out and why. */
export type Coverage = { sharePct: number; included: string[]; excluded: string[]; gaps: CoverageGap[] };

export type Calendar = 'exchange' | 'every_day';

export type WindowResult =
    | {
        id: WindowId;
        available: false;
        // changed_asset_no_history: a what-if whose changed asset has no usable history in the common window
        reason: 'no_holdings' | 'not_enough_history' | 'changed_asset_no_history';
        gap?: CoverageGap;
    }
    | {
        id: WindowId;
        available: true;
        from: string;
        to: string;
        observations: number;                    // daily returns used
        calendar: Calendar;                      // every calendar day (crypto alone) or the days exchanges are open
        periodsPerYear: number;                  // observations a year of that calendar, used to annualise
        coverage: Coverage;
        volatilityPct: number;
        maxDrawdown: Drawdown;
        worstDay: { pct: number; date: string };
        worstSpan20: { pct: number; from: string; to: string } | null;   // 20 observations of `calendar`
        diversificationRatio: number | null;
        risk: WindowRisk[];
        pairs: Array<{ a: string; b: string; correlation: number }>;
        curve: Array<{ date: string; value: number }>;   // indexed to 100, thinned for the chart
    };

export type EngineOutput = {
    holdings: HoldingShare[];                    // largest first
    cashCad: number;
    cashSharePct: number;
    totalValueCad: number;
    concentration: Concentration;
    windows: Record<WindowId, WindowResult>;
    noHistory: string[];                         // held symbols with no daily closes at all
};
