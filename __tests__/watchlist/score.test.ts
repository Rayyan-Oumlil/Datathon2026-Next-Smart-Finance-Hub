import { describe, expect, it } from 'vitest';
import type { HoldingsSummary, Risk, SignalSet } from '@/lib/domain/types';
import { RULES } from '@/lib/rules';
import type { ProfileView } from '@/lib/watchlist/format';
import { scoreCandidate, sectorMedianPe, topDrivers, type Factors, type SectorMedians } from '@/lib/watchlist/score';
import { EMPTY_HOLDINGS, profile, signals } from './fixtures';

const IT = 'Information Technology';
const medians = (median: number, count = 3): SectorMedians => ({ [IT]: { median, count } });
const score = (set: SignalSet, who: ProfileView = profile('Expert', 'Medium'), sectorMedian: SectorMedians = {}, holdings: HoldingsSummary = EMPTY_HOLDINGS) =>
    scoreCandidate(set, who, RULES, { sectorMedianPe: sectorMedian, holdings });

describe('score: weights', () => {
    it('are the board values and sum to 100', () => {
        expect(RULES.score.weights).toEqual({ profile_fit: 40, risk_fit: 25, fundamentals: 20, diversification: 15 });
    });
});

describe('score: profile fit', () => {
    const chip = signals('CHIP', { subIndustry: 'Semiconductors', themes: ['AI', 'dividends'] });
    const fit = (over: Parameters<typeof profile>[2]) => score(chip, profile('Expert', 'Medium', over)).factors.profile_fit;

    it('is 0 when nothing matches', () => {
        expect(fit({})).toEqual({ score: 0, detail: 'sector Information Technology was not picked; niche not picked; no picked theme; not on the brands list: 0 of 100' });
    });
    it('sector picked: 40', () => expect(fit({ sectors: [IT] }).score).toBe(40));
    it('niche picked: 20', () => expect(fit({ niches: ['Semiconductors'] }).score).toBe(20));
    it('theme match: 20, counted once even with two matching themes', () => {
        expect(fit({ themes: ['AI'] }).score).toBe(20);
        expect(fit({ themes: ['AI', 'dividends'] }).score).toBe(20);
    });
    it('on the brands list: 20', () => expect(fit({ brands: ['chip'] }).score).toBe(20));
    it('sector + niche: 60; sector + niche + theme: 80', () => {
        expect(fit({ sectors: [IT], niches: ['Semiconductors'] }).score).toBe(60);
        expect(fit({ sectors: [IT], niches: ['Semiconductors'], themes: ['AI'] }).score).toBe(80);
    });
    it('all four parts: 100, with each part named', () => {
        expect(fit({ sectors: [IT], niches: ['Semiconductors'], themes: ['dividends'], brands: ['CHIP'] })).toEqual({
            score: 100,
            detail: 'sector Information Technology was picked (+40); niche Semiconductors was picked (+20); theme dividends was picked (+20); on the brands list (+20): 100 of 100',
        });
    });
    it('the ESG theme adds no points, even on an entry tagged with it', () => {
        expect(fit({ themes: ['ESG'] }).score).toBe(0);
        const tagged = signals('GREEN', { themes: ['ESG'] });
        expect(score(tagged, profile('Expert', 'Medium', { themes: ['esg'] })).factors.profile_fit.score).toBe(0);
    });
    it('an ETF has no sector to match', () => {
        const fund = signals('FUND', { assetClass: 'etf', sector: undefined, subIndustry: undefined, themes: ['dividends'] });
        expect(score(fund, profile('Expert', 'Medium', { sectors: [IT], themes: ['dividends'] })).factors.profile_fit.score).toBe(20);
    });
});

describe('score: risk fit', () => {
    const cases: Array<[Risk, number, number]> = [
        ['Low', 0, 100], ['Low', 0.1, 100], ['Low', 0.2, 100],                         // whole Low band, no lower side
        ['Medium', 0.2, 100], ['Medium', 0.275, 100], ['Medium', 0.35, 100],            // band edges and middle
        ['Medium', 0.1, 75], ['Medium', 0.15, 87.5], ['Medium', 0.05, 62.5], ['Medium', 0, 50],
        ['High', 0.35, 100], ['High', 0.575, 100], ['High', 0.8, 100],
        ['High', 0.175, 75], ['High', 0.28, 90], ['High', 0, 50],
    ];
    it.each(cases)('%s risk, volatility %f: %f', (risk, volatility, expected) => {
        expect(score(signals('AAA', {}, { volatility }), profile('Expert', risk)).factors.risk_fit.score).toBe(expected);
    });
    it('explains the number', () => {
        expect(score(signals('AAA', {}, { volatility: 0.15 })).factors.risk_fit.detail)
            .toBe('volatility 15.0% is below the 20.0% to 35.0% band for Medium risk: 100 - 50 x (20.0% - 15.0%) / 20.0% = 87.5');
        expect(score(signals('AAA', {}, { volatility: 0.3 })).factors.risk_fit.detail)
            .toBe('volatility 30.0% is inside the 20.0% to 35.0% band for Medium risk: 100');
    });
    it('scores 0, never a guess, for the two cases the filters remove', () => {
        expect(score(signals('AAA', {}, { volatility: 0.5 })).factors.risk_fit.score).toBe(0);
        expect(score(signals('AAA', {}, { volatility: undefined })).factors.risk_fit).toMatchObject({ score: 0, noData: true });
    });
});

describe('score: sector median P/E', () => {
    it('is the middle value, or the mean of the middle two, per sector', () => {
        const sets = [
            signals('A', {}, { pe: 40 }), signals('B', {}, { pe: 20 }), signals('C', {}, { pe: 30 }),
            signals('D', { sector: 'Health Care' }, { pe: 10 }), signals('E', { sector: 'Health Care' }, { pe: 20 }),
        ];
        expect(sectorMedianPe(sets)).toEqual({ [IT]: { median: 30, count: 3 }, 'Health Care': { median: 15, count: 2 } });
    });
    it('ignores missing, zero and negative P/E and assets with no sector', () => {
        const sets = [
            signals('A', {}, { pe: 40 }), signals('B', {}, { pe: -5 }), signals('C', {}, { pe: 0 }), signals('D', {}),
            signals('F', { assetClass: 'etf', sector: undefined }, { pe: 99 }),
        ];
        expect(sectorMedianPe(sets)).toEqual({ [IT]: { median: 40, count: 1 } });
    });
});

describe('score: fundamentals', () => {
    const fundamentals = (pe: number | undefined, growth: number | undefined, median = 20) => score(signals('AAA', {}, { pe, growth }), undefined, medians(median)).factors.fundamentals;

    const peCases: Array<[number, number]> = [
        [5, 100],      // 0.25x: below the 0.5x anchor
        [10, 100],     // 0.5x anchor
        [25, 50],      // 1.25x: midpoint
        [20, 66.7],    // 1.0x: at the median
        [30, 33.3],    // 1.5x
        [40, 0],       // 2.0x anchor
        [80, 0],       // above
    ];
    it.each(peCases)('P/E %f against a median of 20, no growth data: %f', (pe, expected) => {
        expect(fundamentals(pe, undefined).score).toBe(expected);
    });

    const growthCases: Array<[number, number]> = [[-25, 0], [-10, 0], [5, 50], [0, 33.3], [12.5, 75], [20, 100], [60, 100]];
    it.each(growthCases)('growth %f%%, no P/E: %f', (growth, expected) => {
        expect(fundamentals(undefined, growth).score).toBe(expected);
    });

    it('is the mean of the two parts when both have data', () => {
        expect(fundamentals(25, 20)).toEqual({
            score: 75,
            detail: 'P/E 25.0 is 1.25x the median 20.0 of the 3 Information Technology candidate(s) with a P/E in this snapshot: 50.0; revenue growth 20.0% year over year: 100.0; mean of the two: 75.0',
        });
        expect(fundamentals(10, -10).score).toBe(50);
        expect(fundamentals(20, 5).score).toBe(58.3);   // (66.667 + 50) / 2
    });

    it('does not score a negative or zero P/E and uses growth alone', () => {
        expect(fundamentals(-8, 20).score).toBe(100);
        expect(fundamentals(0, -10).score).toBe(0);
        expect(fundamentals(-8, 20).detail).toContain('P/E -8.0 is negative or zero: not scored');
    });

    it('is 50 and flagged "no data" when nothing is available (ETFs, crypto)', () => {
        expect(fundamentals(undefined, undefined)).toEqual({ score: 50, noData: true, detail: 'P/E: no data; revenue growth: no data: no data, set to 50' });
        expect(fundamentals(-3, undefined)).toMatchObject({ score: 50, noData: true });
    });

    it('does not score a P/E with no sector median to compare with', () => {
        const result = score(signals('AAA', {}, { pe: 25 }), undefined, {}).factors.fundamentals;
        expect(result).toMatchObject({ score: 50, noData: true });
    });
});

describe('score: diversification', () => {
    const holdings = (over: Partial<HoldingsSummary>): HoldingsSummary => ({ ...EMPTY_HOLDINGS, ...over });
    const diversification = (set: SignalSet, held: HoldingsSummary) => score(set, undefined, {}, held).factors.diversification;
    const etf = signals('FUND', { assetClass: 'etf', sector: undefined, subIndustry: undefined });

    it('an empty portfolio gives 100 to everything', () => {
        expect(diversification(signals('AAA'), EMPTY_HOLDINGS)).toEqual({
            score: 100, detail: 'its sector Information Technology is not in the simulated holdings: 100',
        });
        expect(diversification(etf, EMPTY_HOLDINGS)).toEqual({ score: 100, detail: 'its asset class etf (no sector) is not in the simulated holdings: 100' });
    });
    it('100 for a stock whose sector is not held, even when other stocks are held', () => {
        const held = holdings({ totalValueCad: 10000, bySector: { Energy: 1000 }, byAssetClass: { stock: 1000 }, symbols: ['OIL'] });
        expect(diversification(signals('AAA'), held)).toEqual({ score: 100, detail: 'its sector Information Technology is not in the simulated holdings: 100' });
        expect(diversification(signals('AAA'), holdings({ totalValueCad: 10000, byAssetClass: { etf: 3000 }, symbols: ['FUND'] })).score).toBe(100);
    });
    it('a new sector scores above a held sector', () => {
        const held = holdings({ totalValueCad: 10000, bySector: { Energy: 1000 }, byAssetClass: { stock: 1000 }, symbols: ['OIL'] });
        const energy = signals('OIL2', { sector: 'Energy' });
        expect(diversification(signals('AAA'), held).score).toBeGreaterThan(diversification(energy, held).score);
    });
    it('50 when the sector is held and is under 20% of the portfolio value', () => {
        const held = holdings({ totalValueCad: 10000, bySector: { [IT]: 1999 }, byAssetClass: { stock: 1999 }, symbols: ['MSFT'] });
        expect(diversification(signals('AAA'), held)).toEqual({ score: 50, detail: 'its sector Information Technology is held and is 19.99% of the portfolio value, under 20%: 50' });
        expect(diversification(signals('AAA'), holdings({ totalValueCad: 10000, bySector: { [IT]: 1000 }, byAssetClass: { stock: 1000 } })).detail)
            .toBe('its sector Information Technology is held and is 10.0% of the portfolio value, under 20%: 50');
    });
    it('0 when the sector is held at exactly 20% or more', () => {
        expect(diversification(signals('AAA'), holdings({ totalValueCad: 10000, bySector: { [IT]: 2000 }, byAssetClass: { stock: 2000 } })).score).toBe(0);
        expect(diversification(signals('AAA'), holdings({ totalValueCad: 10000, bySector: { [IT]: 6000 }, byAssetClass: { stock: 6000 } }))).toEqual({
            score: 0, detail: 'its sector Information Technology is held and is 60.0% of the portfolio value, not under 20%: 0',
        });
    });
    it('an asset with no sector takes the same steps with its asset class', () => {
        expect(diversification(etf, holdings({ totalValueCad: 10000, bySector: { Energy: 3000 }, byAssetClass: { stock: 3000 }, symbols: ['OIL'] })).score).toBe(100);
        expect(diversification(etf, holdings({ totalValueCad: 10000, byAssetClass: { etf: 500 }, symbols: ['SPX'] }))).toEqual({
            score: 50, detail: 'its asset class etf (no sector) is held and is 5.0% of the portfolio value, under 20%: 50',
        });
        expect(diversification(etf, holdings({ totalValueCad: 10000, byAssetClass: { etf: 2000 }, symbols: ['SPX'] })).score).toBe(0);
    });
    it('0 when the group is held but the portfolio value is not known', () => {
        expect(diversification(signals('AAA'), holdings({ totalValueCad: 0, bySector: { [IT]: 100 }, byAssetClass: { stock: 100 } })).score).toBe(0);
    });
});

describe('score: total and top drivers', () => {
    it('total = sum(weight x factor) / 100, rounded to 1 decimal', () => {
        const who = profile('Expert', 'Medium', { sectors: [IT], niches: ['Semiconductors'] });
        const result = score(signals('CHIP', { subIndustry: 'Semiconductors' }, { volatility: 0.15, pe: 20, growth: 5 }), who, medians(20));
        expect(result.factors.profile_fit.score).toBe(60);
        expect(result.factors.risk_fit.score).toBe(87.5);
        expect(result.factors.fundamentals.score).toBe(58.3);
        expect(result.factors.diversification.score).toBe(100);
        // (40 x 60 + 25 x 87.5 + 20 x 58.3 + 15 x 100) / 100 = 24 + 21.875 + 11.66 + 15 = 72.535
        expect(result.total).toBe(72.5);
        expect(result.topDrivers).toEqual(['profile_fit', 'risk_fit']);
    });
    it('ranges from the lowest to the highest possible total', () => {
        const all = profile('Expert', 'Medium', { sectors: [IT], niches: ['Application Software'], themes: ['AI'], brands: ['AAA'] });
        expect(score(signals('AAA', { themes: ['AI'] }, { volatility: 0.3, pe: 10, growth: 20 }), all, medians(20)).total).toBe(100);
        const held: HoldingsSummary = { totalValueCad: 100, bySector: { [IT]: 100 }, byAssetClass: { stock: 100 }, symbols: ['X'] };
        expect(score(signals('AAA', {}, { volatility: 0.5, pe: 40, growth: -10 }), profile('Expert', 'Medium'), medians(20), held).total).toBe(0);
    });
    it('top drivers are the two largest weight x score, in a fixed order when equal', () => {
        const factors = (a: number, b: number, c: number, d: number): Factors => ({
            profile_fit: { score: a, detail: '' }, risk_fit: { score: b, detail: '' }, fundamentals: { score: c, detail: '' }, diversification: { score: d, detail: '' },
        });
        expect(topDrivers(factors(20, 85, 53.3, 100), RULES)).toEqual(['risk_fit', 'diversification']);   // 8, 21.25, 10.66, 15
        expect(topDrivers(factors(0, 0, 100, 100), RULES)).toEqual(['fundamentals', 'diversification']); // 0, 0, 20, 15
        expect(topDrivers(factors(50, 80, 100, 0), RULES)).toEqual(['profile_fit', 'risk_fit']);         // 20, 20, 20, 0: order decides
        expect(topDrivers(factors(0, 0, 0, 0), RULES)).toEqual(['profile_fit', 'risk_fit']);
    });
});
