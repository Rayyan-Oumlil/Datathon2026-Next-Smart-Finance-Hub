import type { FactorDetail, FactorScores, HoldingsSummary, SignalSet } from '@/lib/domain/types';
import type { Rules } from '@/lib/rules';
import { isEsgTheme, normalize, numberOf, own, round1, type ProfileView } from '@/lib/watchlist/format';
import { say, type Locale } from '@/lib/watchlist/text';

export type Factors = Record<keyof FactorScores, FactorDetail>;
export type SectorMedians = Record<string, { median: number; count: number }>;
export type ScoreContext = { sectorMedianPe: SectorMedians; holdings: HoldingsSummary; locale?: Locale };

// Fixed order: used for the total and to settle equal contributions in topDrivers.
export const FACTOR_ORDER: Array<keyof FactorScores> = ['profile_fit', 'risk_fit', 'fundamentals', 'diversification'];

/**
 * Median P/E per sector, over the candidates given (the pipeline passes those that passed the filters).
 * Only positive P/E values count; with an even number of values the median is the mean of the middle two.
 */
export function sectorMedianPe(passed: SignalSet[]): SectorMedians {
    const bySector = new Map<string, number[]>();
    for (const signals of passed) {
        const sector = signals.entry.sector;
        const pe = numberOf(signals.pe);
        if (sector === undefined || pe === undefined || pe <= 0) continue;
        bySector.set(sector, [...(bySector.get(sector) ?? []), pe]);
    }
    const medians: SectorMedians = {};
    for (const sector of [...bySector.keys()].sort()) {
        const values = bySector.get(sector)!.sort((a, b) => a - b);
        const middle = Math.floor(values.length / 2);
        const median = values.length % 2 === 1 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
        medians[sector] = { median, count: values.length };
    }
    return medians;
}

function profileFit(signals: SignalSet, profile: ProfileView, rules: Rules, locale: Locale): FactorDetail {
    const { entry } = signals;
    const { answers } = profile;
    const { parts } = rules.score.factor_formulas.profile_fit;
    const has = (list: string[], value: string | undefined) => value !== undefined && list.some((item) => normalize(item) === normalize(value));
    // ESG is a filter only: it never counts as a theme match
    const matchedTheme = entry.themes.find((theme) => !isEsgTheme(theme) && has(answers.themes, theme));

    const sectorPicked = has(answers.sectors, entry.sector);
    const nichePicked = has(answers.niches, entry.subIndustry);
    const onBrands = has(answers.brands, entry.symbol);
    const sum = (sectorPicked ? parts.sector_picked : 0) + (nichePicked ? parts.niche_picked : 0)
        + (matchedTheme !== undefined ? parts.theme_match : 0) + (onBrands ? parts.on_brands_list : 0);

    const score = Math.min(100, sum);
    const { text, textRef } = say('factor.profile_fit', {
        sector: entry.sector ?? null, sectorPicked, sectorPoints: parts.sector_picked,
        niche: entry.subIndustry ?? null, nichePicked, nichePoints: parts.niche_picked,
        theme: matchedTheme ?? null, themePoints: parts.theme_match,
        onBrands, brandsPoints: parts.on_brands_list,
        score,
    }, locale);
    return { score, detail: text, textRef };
}

function riskFit(signals: SignalSet, profile: ProfileView, rules: Rules, locale: Locale): FactorDetail {
    const [lower, upper] = rules.score.factor_formulas.risk_fit.band_intervals[profile.risk];
    const volatility = numberOf(signals.volatility1y);
    const detail = (state: 'missing' | 'negative' | 'above' | 'inside' | 'below', score: number, noData = false): FactorDetail => {
        const { text, textRef } = say('factor.risk_fit', { state, volatility: volatility ?? null, lower, upper, risk: profile.risk, score }, locale);
        return { score, ...(noData ? { noData: true } : {}), detail: text, textRef };
    };
    // Neither case reaches the score in the pipeline (the volatility filter removes both); they score 0 rather than a guess.
    if (volatility === undefined) return detail('missing', 0, true);
    if (volatility < 0) return detail('negative', 0, true);
    if (volatility > upper) return detail('above', 0);
    if (volatility >= lower) return detail('inside', 100);
    return detail('below', round1(100 - (50 * (lower - volatility)) / lower));
}

// The anchors (0.5x and 2.0x the median; -10% and +20% growth) are the ones written in score.factor_formulas.fundamentals.
function fundamentals(signals: SignalSet, medians: SectorMedians, locale: Locale): FactorDetail {
    const sector = signals.entry.sector;
    const pe = numberOf(signals.pe);
    const growth = numberOf(signals.revenueGrowthPct);
    const sectorMedian = sector !== undefined ? own(medians, sector) : undefined;
    const parts: number[] = [];

    let peState: 'missing' | 'not_positive' | 'no_median' | 'scored';
    let ratio: number | null = null;
    let pePart: number | null = null;
    if (pe === undefined) peState = 'missing';
    else if (pe <= 0) peState = 'not_positive';
    else if (!sectorMedian) peState = 'no_median';
    else {
        peState = 'scored';
        ratio = pe / sectorMedian.median;
        pePart = ratio <= 0.5 ? 100 : ratio >= 2 ? 0 : (100 * (2 - ratio)) / 1.5;
        parts.push(pePart);
    }

    let growthPart: number | null = null;
    if (growth !== undefined) {
        growthPart = growth <= -10 ? 0 : growth >= 20 ? 100 : (100 * (growth + 10)) / 30;
        parts.push(growthPart);
    }

    const noData = parts.length === 0;
    const score = noData ? 50 : round1(parts.reduce((sum, part) => sum + part, 0) / parts.length);
    const { text, textRef } = say('factor.fundamentals', {
        pe: pe ?? null, peState, ratio, median: sectorMedian?.median ?? null, count: sectorMedian?.count ?? null, sector: sector ?? null, pePart,
        growth: growth ?? null, growthPart,
        parts: parts.length, score,
    }, locale);
    return noData ? { score, noData: true, detail: text, textRef } : { score, detail: text, textRef };
}

/**
 * Implemented as the rules file words it (score-v1.1). The group is the asset's sector, or its asset class when it
 * has no sector (ETF, crypto):
 *   100 if the group is not held; 50 if it is held and is under 20% of the portfolio value; 0 otherwise.
 * "Held" means a value above 0 in the holdings summary.
 */
const DIVERSIFICATION_THRESHOLD = 0.2;

function diversification(signals: SignalSet, holdings: HoldingsSummary, locale: Locale): FactorDetail {
    const { sector, assetClass } = signals.entry;
    const value = (sector !== undefined ? own(holdings.bySector, sector) : own(holdings.byAssetClass, assetClass)) ?? 0;
    const detail = (state: 'not_held' | 'total_unknown' | 'under' | 'not_under', share: number | null, score: number): FactorDetail => {
        const { text, textRef } = say('factor.diversification', {
            group: sector !== undefined ? 'sector' : 'asset_class', name: sector ?? assetClass, state, share, threshold: DIVERSIFICATION_THRESHOLD, score,
        }, locale);
        return { score, detail: text, textRef };
    };

    if (value <= 0) return detail('not_held', null, 100);
    if (!(holdings.totalValueCad > 0)) return detail('total_unknown', null, 0);
    const share = value / holdings.totalValueCad;
    if (share < DIVERSIFICATION_THRESHOLD) return detail('under', share, 50);
    return detail('not_under', share, 0);
}

/** The two factors with the largest weighted contribution (weight x score); equal contributions keep FACTOR_ORDER. */
export function topDrivers(factors: Factors, rules: Rules): Array<keyof FactorScores> {
    const { weights } = rules.score;
    return [...FACTOR_ORDER]
        .sort((a, b) => weights[b] * factors[b].score - weights[a] * factors[a].score || FACTOR_ORDER.indexOf(a) - FACTOR_ORDER.indexOf(b))
        .slice(0, 2);
}

/**
 * Stage C. Each factor is 0-100, rounded to 1 decimal. The total is sum(weight x factor) / 100 computed from those
 * rounded factor scores and rounded to 1 decimal, so the total can be recomputed from the numbers shown.
 * The details are written in context.locale (default English); the scores never depend on it.
 */
export function scoreCandidate(signals: SignalSet, profile: ProfileView, rules: Rules, context: ScoreContext): { factors: Factors; total: number; topDrivers: Array<keyof FactorScores> } {
    const locale = context.locale ?? 'en';
    const factors: Factors = {
        profile_fit: profileFit(signals, profile, rules, locale),
        risk_fit: riskFit(signals, profile, rules, locale),
        fundamentals: fundamentals(signals, context.sectorMedianPe, locale),
        diversification: diversification(signals, context.holdings, locale),
    };
    const { weights } = rules.score;
    const total = round1(FACTOR_ORDER.reduce((sum, factor) => sum + weights[factor] * factors[factor].score, 0) / 100);
    return { factors, total, topDrivers: topDrivers(factors, rules) };
}
