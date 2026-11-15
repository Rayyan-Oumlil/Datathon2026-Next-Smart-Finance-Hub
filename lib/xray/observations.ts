// "What stands out": plain readings of the X-ray's own numbers, chosen by fixed rules. They describe the portfolio;
// they never tell the user what to do. A reading may carry a test to try in the what-if lab (the app's way of
// letting the user see the effect of a change), never an instruction. Pure: no I/O, no wording (the components
// write each sentence in the language from its id and values).

import type { WindowResult } from './types';

/** The thresholds of the readings. They are this app's own first values, shown as such, not regulatory limits. */
export const OBSERVATION_RULES = {
    riskGapRatio: 1.5,          // a holding's risk share at least this many times its value share...
    riskGapMinPct: 30,          // ...and at least this share of the risk
    topHoldingPct: 30,          // largest position, in % of the portfolio
    fewEffectiveHoldings: 3,    // effective holdings below this
    nearBandRatio: 0.8,         // volatility at least this share of the profile limit
    pairCorrelation: 0.7,       // two holdings whose daily moves were this alike
    usdSharePct: 50,            // share of the portfolio in USD
    cashSharePct: 50,           // share of the portfolio in cash
    lowDiversificationRatio: 1.15,
    testShare: 0.25,            // the test offered reduces a position by this share of its value
    max: 4,
} as const;

export type Observation =
    | { id: 'risk_gap'; symbol: string; valuePct: number; riskPct: number; test: Test }
    | { id: 'above_band' | 'near_band'; volatilityPct: number; limitPct: number }
    | { id: 'top_holding'; symbol: string; sharePct: number; test: Test }
    | { id: 'few_holdings'; effective: number }
    | { id: 'close_pair'; a: string; b: string; correlation: number }
    | { id: 'currency'; sharePct: number }
    | { id: 'cash_heavy'; sharePct: number }
    | { id: 'little_cushion'; ratio: number }
    | { id: 'left_out'; symbols: string[]; sharePct: number };

/** A change to try in the lab: reduce `symbol` by `amountCad`. */
export type Test = { symbol: string; direction: 'reduce'; amountCad: number };

type Input = {
    holdings: Array<{ symbol: string; valueCad: number; currency: string }>;
    concentration: { topHolding: { symbol: string; sharePct: number } | null; effectiveHoldings: number | null };
    currencies: Array<{ name: string; sharePct: number }>;
    cashSharePct: number;
    band: { volatilityLimitPct: number } | null;
    window: Extract<WindowResult, { available: true }>;
};

const R = OBSERVATION_RULES;
const testFor = (input: Input, symbol: string): Test | null => {
    const value = input.holdings.find((h) => h.symbol === symbol)?.valueCad ?? 0;
    const amountCad = Math.round(value * R.testShare);
    return amountCad > 0 ? { symbol, direction: 'reduce', amountCad } : null;
};

/** The readings that apply, in order of how much they say, at most `OBSERVATION_RULES.max`. */
export function observationsOf(input: Input): Observation[] {
    const { window: w, concentration } = input;
    const found: Observation[] = [];

    const gap = w.risk
        .filter((r) => r.riskSharePct !== null && r.riskSharePct >= R.riskGapMinPct && r.riskSharePct >= r.weightPct * R.riskGapRatio)
        .sort((a, b) => b.riskSharePct! - b.weightPct - (a.riskSharePct! - a.weightPct))[0];
    const gapTest = gap ? testFor(input, gap.symbol) : null;
    if (gap && gapTest) found.push({ id: 'risk_gap', symbol: gap.symbol, valuePct: gap.weightPct, riskPct: gap.riskSharePct!, test: gapTest });

    if (input.band) {
        if (w.volatilityPct > input.band.volatilityLimitPct) found.push({ id: 'above_band', volatilityPct: w.volatilityPct, limitPct: input.band.volatilityLimitPct });
        else if (w.volatilityPct >= input.band.volatilityLimitPct * R.nearBandRatio) found.push({ id: 'near_band', volatilityPct: w.volatilityPct, limitPct: input.band.volatilityLimitPct });
    }

    const top = concentration.topHolding;
    const topTest = top ? testFor(input, top.symbol) : null;
    // The risk gap already names a holding; the same one is not named twice
    if (top && topTest && top.sharePct >= R.topHoldingPct && top.symbol !== gap?.symbol) found.push({ id: 'top_holding', symbol: top.symbol, sharePct: top.sharePct, test: topTest });

    const pair = w.pairs[0];
    if (pair && pair.correlation >= R.pairCorrelation) found.push({ id: 'close_pair', a: pair.a, b: pair.b, correlation: pair.correlation });

    if (w.diversificationRatio !== null && w.risk.length >= 2 && w.diversificationRatio < R.lowDiversificationRatio) found.push({ id: 'little_cushion', ratio: w.diversificationRatio });

    if (concentration.effectiveHoldings !== null && input.holdings.length >= 2 && concentration.effectiveHoldings < R.fewEffectiveHoldings) {
        found.push({ id: 'few_holdings', effective: concentration.effectiveHoldings });
    }

    const usd = input.currencies.find((c) => c.name === 'USD');
    if (usd && usd.sharePct >= R.usdSharePct) found.push({ id: 'currency', sharePct: usd.sharePct });

    if (input.cashSharePct >= R.cashSharePct) found.push({ id: 'cash_heavy', sharePct: input.cashSharePct });

    if (w.coverage.excluded.length > 0) found.push({ id: 'left_out', symbols: w.coverage.excluded, sharePct: w.coverage.sharePct });

    return found.slice(0, R.max);
}
