// Hand-built fixtures shared by the watchlist tests. Nothing here comes from a provider.
import type { HoldingsSummary, Level, OnboardingAnswers, Risk, SignalSet, Sourced, UniverseEntry } from '@/lib/domain/types';
import type { ProfileView } from '@/lib/watchlist/format';

export const NOW = '2026-11-14T12:00:00.000Z';

export function sourced<T = number>(value: T, extra: Partial<Sourced<T>> = {}): Sourced<T> {
    return { value, source: 'test fixture', fetchedAt: NOW, ...extra };
}

export function answers(over: Partial<OnboardingAnswers> = {}): OnboardingAnswers {
    return {
        goal: 'find ideas',
        traded: true,
        experience: '1-5y',
        tools: ['limit_or_stop'],
        investingGoal: 'growth',
        echeance: '1 yr',
        drop20: 'wait',
        selfRating: 'medium',
        markets: 'US',
        sectors: [],
        niches: [],
        themes: [],
        brands: [],
        avoid: [],
        agentStyle: 'just the data',
        ...over,
    };
}

export function profile(level: Level, risk: Risk, over: Partial<OnboardingAnswers> = {}): ProfileView {
    return { level, risk, answers: answers(over) };
}

export function entry(symbol: string, over: Partial<UniverseEntry> = {}): UniverseEntry {
    return {
        symbol,
        name: `${symbol} Inc.`,
        assetClass: 'stock',
        market: 'US',
        sector: 'Information Technology',
        subIndustry: 'Application Software',
        themes: [],
        esg: 'not screened',
        listSource: 'hand-built test list',
        ...over,
    };
}

export type SignalValues = {
    volatility?: number;
    marketCap?: number;
    traded?: number;
    pe?: number;
    growth?: number;
    change?: number;
    closes?: number[];
};

/** A signal set that passes every filter for a Medium-risk profile unless a value is overridden. Pass `undefined` to leave a value out. */
export function signals(symbol: string, entryOver: Partial<UniverseEntry> = {}, values: SignalValues = {}): SignalSet {
    const v: SignalValues = { volatility: 0.25, marketCap: 50e9, traded: 100e6, ...values };
    const set: SignalSet = { symbol, entry: entry(symbol, entryOver), missing: [] };
    if (v.volatility !== undefined) set.volatility1y = sourced(v.volatility, { unit: 'fraction', source: 'derived' });
    if (v.marketCap !== undefined) set.marketCapUsd = sourced(v.marketCap, { currency: 'USD' });
    if (v.traded !== undefined) set.avgDailyTradedValueUsd = sourced(v.traded, { currency: 'USD' });
    if (v.pe !== undefined) set.pe = sourced(v.pe, { unit: 'ratio' });
    if (v.growth !== undefined) set.revenueGrowthPct = sourced(v.growth, { unit: '%' });
    if (v.change !== undefined) set.changePercent = sourced(v.change, { unit: '%', source: 'quote fixture' });
    if (v.closes !== undefined) set.closes1m = sourced(v.closes, { source: 'closes fixture' });
    return set;
}

export const EMPTY_HOLDINGS: HoldingsSummary = { totalValueCad: 0, bySector: {}, byAssetClass: {}, symbols: [] };

/** A fixed reordering (no randomness): reverse, then move the first third to the end. */
export function shuffled<T>(items: T[]): T[] {
    const reversed = [...items].reverse();
    const cut = Math.floor(reversed.length / 3);
    return [...reversed.slice(cut), ...reversed.slice(0, cut)];
}
