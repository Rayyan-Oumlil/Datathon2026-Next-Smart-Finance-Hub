import type { FactorDetail, FactorScores, HoldingsSummary, SignalSet } from '@/lib/domain/types';
import type { Rules } from '@/lib/rules';
import { formatPercent, formatPercentPair, normalize, numberOf, own, round1, type ProfileView } from '@/lib/watchlist/format';

export type Factors = Record<keyof FactorScores, FactorDetail>;
export type SectorMedians = Record<string, { median: number; count: number }>;
export type ScoreContext = { sectorMedianPe: SectorMedians; holdings: HoldingsSummary };

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

function profileFit(signals: SignalSet, profile: ProfileView, rules: Rules): FactorDetail {
    const { entry } = signals;
    const { answers } = profile;
    const { parts } = rules.score.factor_formulas.profile_fit;
    const has = (list: string[], value: string | undefined) => value !== undefined && list.some((item) => normalize(item) === normalize(value));
    const matchedTheme = entry.themes.find((theme) => has(answers.themes, theme));

    const facts: string[] = [];
    let sum = 0;
    const add = (applies: boolean, points: number, yes: string, no: string) => {
        if (applies) sum += points;
        facts.push(applies ? `${yes} (+${points})` : no);
    };
    add(has(answers.sectors, entry.sector), parts.sector_picked, `sector ${entry.sector} was picked`, entry.sector ? `sector ${entry.sector} was not picked` : 'no sector');
    add(has(answers.niches, entry.subIndustry), parts.niche_picked, `niche ${entry.subIndustry} was picked`, 'niche not picked');
    add(matchedTheme !== undefined, parts.theme_match, `theme ${matchedTheme} was picked`, 'no picked theme');
    add(has(answers.brands, entry.symbol), parts.on_brands_list, 'on the brands list', 'not on the brands list');

    const score = Math.min(100, sum);
    return { score, detail: `${facts.join('; ')}: ${score} of 100` };
}

function riskFit(signals: SignalSet, profile: ProfileView, rules: Rules): FactorDetail {
    const [lower, upper] = rules.score.factor_formulas.risk_fit.band_intervals[profile.risk];
    const band = `${formatPercent(lower)} to ${formatPercent(upper)} band for ${profile.risk} risk`;
    const volatility = numberOf(signals.volatility1y);
    // Neither case reaches the score in the pipeline (the volatility filter removes both); they score 0 rather than a guess.
    if (volatility === undefined) return { score: 0, noData: true, detail: '1-year volatility is missing: no risk fit can be computed' };
    if (volatility < 0) return { score: 0, noData: true, detail: `1-year volatility ${formatPercent(volatility)} is negative, which is not a valid value: no risk fit can be computed` };
    if (volatility > upper) return { score: 0, detail: `volatility ${formatPercent(volatility)} is above the ${band}: 0` };
    if (volatility >= lower) return { score: 100, detail: `volatility ${formatPercent(volatility)} is inside the ${band}: 100` };
    const score = round1(100 - (50 * (lower - volatility)) / lower);
    return {
        score,
        detail: `volatility ${formatPercent(volatility)} is below the ${band}: 100 - 50 x (${formatPercent(lower)} - ${formatPercent(volatility)}) / ${formatPercent(lower)} = ${score.toFixed(1)}`,
    };
}

// The anchors (0.5x and 2.0x the median; -10% and +20% growth) are the ones written in score.factor_formulas.fundamentals.
function fundamentals(signals: SignalSet, medians: SectorMedians): FactorDetail {
    const sector = signals.entry.sector;
    const pe = numberOf(signals.pe);
    const growth = numberOf(signals.revenueGrowthPct);
    const sectorMedian = sector !== undefined ? own(medians, sector) : undefined;
    const parts: number[] = [];
    const facts: string[] = [];

    if (pe === undefined) facts.push('P/E: no data');
    else if (pe <= 0) facts.push(`P/E ${pe.toFixed(1)} is negative or zero: not scored`);
    else if (!sectorMedian) facts.push(`P/E ${pe.toFixed(1)}: no sector median to compare with, not scored`);
    else {
        const ratio = pe / sectorMedian.median;
        const part = ratio <= 0.5 ? 100 : ratio >= 2 ? 0 : (100 * (2 - ratio)) / 1.5;
        parts.push(part);
        facts.push(`P/E ${pe.toFixed(1)} is ${ratio.toFixed(2)}x the median ${sectorMedian.median.toFixed(1)} of the ${sectorMedian.count} ${sector} candidate(s) with a P/E in this snapshot: ${part.toFixed(1)}`);
    }

    if (growth === undefined) facts.push('revenue growth: no data');
    else {
        const part = growth <= -10 ? 0 : growth >= 20 ? 100 : (100 * (growth + 10)) / 30;
        parts.push(part);
        facts.push(`revenue growth ${growth.toFixed(1)}% year over year: ${part.toFixed(1)}`);
    }

    if (parts.length === 0) return { score: 50, noData: true, detail: `${facts.join('; ')}: no data, set to 50` };
    const score = round1(parts.reduce((sum, part) => sum + part, 0) / parts.length);
    const how = parts.length === 2 ? 'mean of the two' : 'the only part with data';
    return { score, detail: `${facts.join('; ')}; ${how}: ${score.toFixed(1)}` };
}

/**
 * Implemented exactly as the rules file words it:
 *   100 if neither the sector nor the asset class is held; 50 if the sector is held and is under 20% of the
 *   portfolio value; 0 otherwise.
 * "Held" means a value above 0 in the holdings summary. An asset with no sector (ETF, crypto) can never take the
 * 50 branch, and a stock in a new sector scores 0 once any stock is held, because its asset class is then held.
 */
function diversification(signals: SignalSet, holdings: HoldingsSummary): FactorDetail {
    const { sector, assetClass } = signals.entry;
    const sectorValue = sector !== undefined ? own(holdings.bySector, sector) ?? 0 : 0;
    const classValue = own(holdings.byAssetClass, assetClass) ?? 0;
    const sectorText = sector ?? 'no sector';

    if (sectorValue <= 0 && classValue <= 0) {
        return { score: 100, detail: `neither its sector (${sectorText}) nor its asset class (${assetClass}) is in the simulated holdings: 100` };
    }
    if (sectorValue > 0) {
        if (!(holdings.totalValueCad > 0)) return { score: 0, detail: `${sector} is held but the portfolio value is not known, so its share cannot be shown to be under 20%: 0` };
        const share = sectorValue / holdings.totalValueCad;
        const [shareText] = formatPercentPair(share, 0.2);
        if (share < 0.2) return { score: 50, detail: `${sector} is held and is ${shareText} of the portfolio value, under 20%: 50` };
        return { score: 0, detail: `${sector} is held and is ${shareText} of the portfolio value, not under 20%: 0` };
    }
    return { score: 0, detail: `its sector (${sectorText}) is not held but its asset class (${assetClass}) already is: 0` };
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
 */
export function scoreCandidate(signals: SignalSet, profile: ProfileView, rules: Rules, context: ScoreContext): { factors: Factors; total: number; topDrivers: Array<keyof FactorScores> } {
    const factors: Factors = {
        profile_fit: profileFit(signals, profile, rules),
        risk_fit: riskFit(signals, profile, rules),
        fundamentals: fundamentals(signals, context.sectorMedianPe),
        diversification: diversification(signals, context.holdings),
    };
    const { weights } = rules.score;
    const total = round1(FACTOR_ORDER.reduce((sum, factor) => sum + weights[factor] * factors[factor].score, 0) / 100);
    return { factors, total, topDrivers: topDrivers(factors, rules) };
}
