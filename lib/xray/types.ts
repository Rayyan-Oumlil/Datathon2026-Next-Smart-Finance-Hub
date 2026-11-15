// Shapes of the portfolio X-ray (method xray-v1, docs/superpowers/specs/2026-11-15-portfolio-xray-design.md).
// Percent fields are numbers in percent (31.24 means 31.24 %), rounded for display; correlations are coefficients.

import type { DailyClose } from '@/lib/sources/types';

export const XRAY_VERSION = 'xray-v1';

export const WINDOW_IDS = ['full', 'y2022', 'last12m'] as const;
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

export type WindowResult =
    | { id: WindowId; available: false; reason: 'no_holdings' | 'not_enough_history' }
    | {
        id: WindowId;
        available: true;
        from: string;
        to: string;
        observations: number;                    // daily returns used
        coverage: { sharePct: number; included: string[]; excluded: string[] };
        volatilityPct: number;
        maxDrawdown: Drawdown;
        worstDay: { pct: number; date: string };
        worstSpan20: { pct: number; from: string; to: string } | null;
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
