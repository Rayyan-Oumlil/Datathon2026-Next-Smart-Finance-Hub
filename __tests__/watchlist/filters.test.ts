import { describe, expect, it } from 'vitest';
import type { FilterCheck, Risk, SignalSet } from '@/lib/domain/types';
import { RULES } from '@/lib/rules';
import { checkProfileConflict } from '@/lib/watchlist/conflict';
import { runFilters } from '@/lib/watchlist/filters';
import type { ProfileView } from '@/lib/watchlist/format';
import { profile, signals, sourced, withoutTextRefs } from './fixtures';

const run = (set: SignalSet, who: ProfileView, fx = sourced(1.25, { source: 'Bank of Canada' })) => withoutTextRefs(runFilters(set, who, RULES, fx));
const passed = (checks: FilterCheck[]) => checks.every((check) => check.pass);
const failed = (checks: FilterCheck[]) => checks.filter((check) => !check.pass);
const only = (checks: FilterCheck[], filter: FilterCheck['filter']) => {
    const found = checks.filter((check) => check.filter === filter);
    expect(found).toHaveLength(1);
    return found[0];
};
const medium = profile('Intermediate', 'Medium');
const etf = { assetClass: 'etf' as const, sector: undefined, subIndustry: undefined };
const crypto = { assetClass: 'crypto' as const, market: 'none' as const, sector: undefined, subIndustry: undefined };

describe('filters: which checks run for each asset class', () => {
    const names = (set: SignalSet, who: ProfileView) => run(set, who).map((check) => check.filter);

    it('stock: every filter', () => {
        expect(names(signals('AAA'), medium)).toEqual(['avoid_list', 'markets', 'volatility', 'market_cap_floor', 'liquidity', 'esg']);
        expect(passed(run(signals('AAA'), medium))).toBe(true);
    });
    it('stock for a Novice: plus the Novice floor', () => {
        expect(names(signals('AAA'), profile('Novice', 'Medium'))).toEqual(['avoid_list', 'markets', 'volatility', 'market_cap_floor', 'liquidity', 'esg', 'novice']);
    });
    it('ETF: no market-cap floor', () => {
        expect(names(signals('FUND', etf, { marketCap: undefined }), medium)).toEqual(['avoid_list', 'markets', 'volatility', 'liquidity', 'esg']);
    });
    it('crypto: avoid list, volatility and the risk rule', () => {
        expect(names(signals('BTC', crypto), profile('Expert', 'High'))).toEqual(['avoid_list', 'volatility', 'crypto_risk']);
    });
    it('gold and bond yields: the avoid list only, with no market data needed', () => {
        const gold = signals('GOLD', { ...crypto, assetClass: 'gold' }, { volatility: undefined, marketCap: undefined, traded: undefined });
        const bond = signals('CA5Y', { ...crypto, assetClass: 'bond_yield' }, { volatility: undefined, marketCap: undefined, traded: undefined });
        for (const risk of ['Low', 'Medium', 'High'] as Risk[]) {
            expect(run(gold, profile('Novice', risk))).toEqual([{ filter: 'avoid_list', pass: true, detail: 'GOLD is not on the avoid list' }]);
            expect(passed(run(bond, profile('Novice', risk)))).toBe(true);
        }
        expect(passed(run(gold, profile('Expert', 'High', { avoid: ['gold'] })))).toBe(false);
    });
});

describe('filter: avoid list', () => {
    it('fails a ticker on the list, whatever the case', () => {
        const check = only(run(signals('AAA'), profile('Expert', 'Medium', { avoid: ['aaa'] })), 'avoid_list');
        expect(check).toEqual({ filter: 'avoid_list', pass: false, detail: 'AAA is on the avoid list' });
    });
    it('fails a sector on the list', () => {
        const check = only(run(signals('OIL', { sector: 'Energy' }), profile('Expert', 'Medium', { avoid: ['Energy'] })), 'avoid_list');
        expect(check).toEqual({ filter: 'avoid_list', pass: false, detail: 'OIL is in Energy, a sector on the avoid list' });
    });
    it('passes anything else and says so', () => {
        const check = only(run(signals('AAA'), profile('Expert', 'Medium', { avoid: ['Energy', 'ZZZ'] })), 'avoid_list');
        expect(check).toEqual({ filter: 'avoid_list', pass: true, detail: 'AAA and its sector Information Technology are not on the avoid list' });
    });
});

describe('filter: markets', () => {
    const cases: Array<['US' | 'Canada' | 'global', 'US' | 'Canada', boolean]> = [
        ['US', 'US', true], ['US', 'Canada', false], ['Canada', 'Canada', true], ['Canada', 'US', false], ['global', 'US', true], ['global', 'Canada', true],
    ];
    it.each(cases)('picked %s, listed in %s: pass %s', (picked, market, pass) => {
        const check = only(run(signals('AAA', { market }), profile('Expert', 'Medium', { markets: picked })), 'markets');
        expect(check.pass).toBe(pass);
        expect(check.detail).toBe(`AAA is listed in ${market}; markets picked: ${picked === 'global' ? 'global (US and Canada)' : picked}`);
    });
    it('fails a stock with no market on file', () => {
        expect(only(run(signals('AAA', { market: 'none' }), medium), 'markets').pass).toBe(false);
    });
});

describe('filter: volatility cap by risk', () => {
    const cases: Array<[Risk, number, boolean, string]> = [
        ['Low', 0.2, true, 'volatility 20.0% is at the 20.0% cap for Low risk'],
        ['Low', 0.2001, false, 'volatility 20.01% is above the 20.00% cap for Low risk'],
        ['Low', 0.12, true, 'volatility 12.0% is within the 20.0% cap for Low risk'],
        ['Medium', 0.35, true, 'volatility 35.0% is at the 35.0% cap for Medium risk'],
        ['Medium', 0.3501, false, 'volatility 35.01% is above the 35.00% cap for Medium risk'],
        ['Medium', 0.412, false, 'volatility 41.2% is above the 35.0% cap for Medium risk'],
        ['High', 0.8, true, 'volatility 80.0% is at the 80.0% cap for High risk'],
        ['High', 0.8001, false, 'volatility 80.01% is above the 80.00% cap for High risk'],
        ['High', 0.5, true, 'volatility 50.0% is within the 80.0% cap for High risk'],
    ];
    it.each(cases)('%s risk, volatility %f: pass %s', (risk, volatility, pass, detail) => {
        const check = only(run(signals('AAA', {}, { volatility }), profile('Expert', risk)), 'volatility');
        expect(check).toEqual({ filter: 'volatility', pass, value: volatility, limit: RULES.filters.volatility.cap_by_risk[risk], detail });
    });
    it('applies to ETFs and crypto too', () => {
        expect(only(run(signals('FUND', etf, { volatility: 0.36 }), medium), 'volatility').pass).toBe(false);
        expect(only(run(signals('BTC', crypto, { volatility: 0.81 }), profile('Expert', 'High')), 'volatility').pass).toBe(false);
    });
});

describe('filter: market-cap floor by risk (stocks only)', () => {
    const cases: Array<[Risk, number, boolean, string]> = [
        ['Low', 10e9, true, 'market cap US$10.0B is at the US$10.0B floor for Low risk'],
        ['Low', 10e9 - 1, false, 'market cap US$9,999,999,999 is below the US$10,000,000,000 floor for Low risk'],
        ['Low', 9.5e9, false, 'market cap US$9.5B is below the US$10.0B floor for Low risk'],
        ['Medium', 2e9, true, 'market cap US$2.0B is at the US$2.0B floor for Medium risk'],
        ['Medium', 2e9 - 1, false, 'market cap US$1,999,999,999 is below the US$2,000,000,000 floor for Medium risk'],
        ['Medium', 50e9, true, 'market cap US$50.0B is above the US$2.0B floor for Medium risk'],
        ['High', 300e6, true, 'market cap US$300.0M is at the US$300.0M floor for High risk'],
        ['High', 300e6 - 1, false, 'market cap US$299,999,999 is below the US$300,000,000 floor for High risk'],
    ];
    it.each(cases)('%s risk, market cap %f: pass %s', (risk, marketCap, pass, detail) => {
        const check = only(run(signals('AAA', {}, { marketCap }), profile('Expert', risk)), 'market_cap_floor');
        expect(check).toEqual({ filter: 'market_cap_floor', pass, value: marketCap, limit: RULES.filters.market_cap_floor_usd.by_risk[risk], detail });
    });

    it('converts a market cap still in CAD with the snapshot rate before comparing', () => {
        const set = signals('RY.TO', { market: 'Canada' });
        set.marketCapUsd = sourced(12.5e9, { currency: 'CAD' });
        const who = profile('Expert', 'Low', { markets: 'Canada' });
        expect(only(run(set, who, sourced(1.25)), 'market_cap_floor')).toMatchObject({ pass: true, value: 10e9 });   // 12.5B CAD / 1.25 = 10.0B USD
        expect(only(run(set, who, sourced(1.26)), 'market_cap_floor').pass).toBe(false);                             // 9.92B USD
    });

    it('fails on missing data, not on a guess, when the CAD value cannot be converted', () => {
        const set = signals('RY.TO', { market: 'Canada' });
        set.marketCapUsd = sourced(12.5e9, { currency: 'CAD' });
        const checks = withoutTextRefs(runFilters(set, profile('Expert', 'Low', { markets: 'Canada' }), RULES, undefined));
        expect(only(checks, 'data')).toEqual({ filter: 'data', pass: false, detail: 'USD/CAD rate is missing, so the market cap in CAD cannot be converted for the market-cap floor' });
    });

    it('is not applied to an ETF, even a tiny one', () => {
        const checks = run(signals('FUND', etf, { marketCap: 1e6 }), medium);
        expect(checks.some((check) => check.filter === 'market_cap_floor')).toBe(false);
        expect(passed(checks)).toBe(true);
    });
});

describe('filter: liquidity', () => {
    it('passes at exactly US$1M a day', () => {
        expect(only(run(signals('AAA', {}, { traded: 1e6 }), medium), 'liquidity')).toEqual({
            filter: 'liquidity', pass: true, value: 1e6, limit: 1e6, detail: 'average traded value US$1.0M a day is at the US$1.0M a day minimum',
        });
    });
    it('fails one dollar under', () => {
        expect(only(run(signals('AAA', {}, { traded: 999_999 }), medium), 'liquidity')).toEqual({
            filter: 'liquidity', pass: false, value: 999_999, limit: 1e6, detail: 'average traded value US$999,999 a day is below the US$1.0M a day minimum',
        });
    });
    it('applies to ETFs', () => {
        expect(only(run(signals('FUND', etf, { traded: 0.5e6 }), medium), 'liquidity').detail).toBe('average traded value US$500,000 a day is below the US$1.0M a day minimum');
    });
});

describe('filter: ESG (mock tag)', () => {
    const esgProfile = profile('Expert', 'Medium', { themes: ['AI', 'ESG'] });
    it('lets only "screened" pass when the ESG theme is picked', () => {
        expect(only(run(signals('AAA', { esg: 'screened' }), esgProfile), 'esg')).toEqual({
            filter: 'esg', pass: true, detail: 'ESG theme picked: only "screened" passes; the ESG tag is "screened" (demo data)',
        });
        expect(only(run(signals('AAA', { esg: 'not screened' }), esgProfile), 'esg').pass).toBe(false);
        expect(only(run(signals('AAA', { esg: 'controversy' }), esgProfile), 'esg')).toEqual({
            filter: 'esg', pass: false, detail: 'ESG theme picked: only "screened" passes; the ESG tag is "controversy" (demo data)',
        });
    });
    it('does not check the tag when the theme is not picked', () => {
        expect(only(run(signals('AAA', { esg: 'controversy' }), medium), 'esg')).toEqual({
            filter: 'esg', pass: true, detail: 'ESG theme not picked, so the ESG tag "controversy" (demo data) is not checked',
        });
    });
    it('applies to ETFs but not to crypto', () => {
        expect(only(run(signals('FUND', { ...etf, esg: 'controversy' }), esgProfile), 'esg').pass).toBe(false);
        expect(run(signals('BTC', { ...crypto, esg: 'controversy' }), profile('Expert', 'High', { themes: ['ESG'] })).some((check) => check.filter === 'esg')).toBe(false);
    });
});

describe('filter: Novice rules', () => {
    it('stocks need US$10B whatever the risk band', () => {
        const high = profile('Novice', 'High');
        expect(only(run(signals('AAA', {}, { marketCap: 10e9 }), high), 'novice')).toEqual({
            filter: 'novice', pass: true, value: 10e9, limit: 10e9, detail: 'market cap US$10.0B is at the US$10.0B floor for Novice stocks',
        });
        const below = run(signals('AAA', {}, { marketCap: 10e9 - 1 }), high);
        expect(only(below, 'market_cap_floor').pass).toBe(true);   // above the US$300M High-risk floor
        expect(only(below, 'novice')).toEqual({
            filter: 'novice', pass: false, value: 10e9 - 1, limit: 10e9, detail: 'market cap US$9,999,999,999 is below the US$10,000,000,000 floor for Novice stocks',
        });
        expect(run(signals('AAA', {}, { marketCap: 5e9 }), profile('Intermediate', 'High')).some((check) => check.filter === 'novice')).toBe(false);
    });
    it('ETFs must be on the blue-chip list', () => {
        const novice = profile('Novice', 'Medium');
        expect(only(run(signals('SPX', { ...etf, blueChipEtf: true }), novice), 'novice')).toEqual({
            filter: 'novice', pass: true, detail: 'SPX is on the blue-chip ETF list; a Novice only gets blue-chip ETFs',
        });
        expect(only(run(signals('ARKX', etf), novice), 'novice')).toEqual({
            filter: 'novice', pass: false, detail: 'ARKX is not on the blue-chip ETF list; a Novice only gets blue-chip ETFs',
        });
        expect(passed(run(signals('ARKX', etf), medium))).toBe(true);
    });
    it('crypto is never listed, even at High risk', () => {
        const checks = run(signals('BTC', crypto, { volatility: 0.5 }), profile('Novice', 'High'));
        expect(only(checks, 'crypto_risk').pass).toBe(true);
        expect(only(checks, 'novice')).toEqual({ filter: 'novice', pass: false, detail: 'crypto is never listed for a Novice' });
    });
});

describe('filter: Low-risk ETF rule', () => {
    it('only blue-chip ETFs for a Low risk profile, at any level', () => {
        const low = profile('Expert', 'Low');
        expect(only(run(signals('SPX', { ...etf, blueChipEtf: true }, { volatility: 0.15 }), low), 'low_risk_etf')).toEqual({
            filter: 'low_risk_etf', pass: true, detail: 'SPX is on the blue-chip ETF list; a Low risk profile only gets blue-chip ETFs',
        });
        const other = run(signals('ARKX', etf, { volatility: 0.15 }), low);
        expect(failed(other)).toEqual([{ filter: 'low_risk_etf', pass: false, detail: 'ARKX is not on the blue-chip ETF list; a Low risk profile only gets blue-chip ETFs' }]);
    });
    it('reports both rules for a Novice with Low risk', () => {
        expect(failed(run(signals('ARKX', etf, { volatility: 0.15 }), profile('Novice', 'Low'))).map((check) => check.filter)).toEqual(['novice', 'low_risk_etf']);
    });
    it('does not exist for Medium or High risk', () => {
        expect(run(signals('ARKX', etf), medium).some((check) => check.filter === 'low_risk_etf')).toBe(false);
    });
});

describe('filter: crypto', () => {
    it.each([['Low', false], ['Medium', false], ['High', true]] as Array<[Risk, boolean]>)('%s risk: pass %s', (risk, pass) => {
        const check = only(run(signals('ETH', crypto, { volatility: 0.15 }), profile('Expert', risk)), 'crypto_risk');
        expect(check).toEqual({ filter: 'crypto_risk', pass, detail: `crypto is listed for High risk only; the profile's risk is ${risk}` });
    });
    it('passes BTC for an Expert at High risk within the volatility cap, with no market cap or liquidity needed', () => {
        expect(passed(run(signals('BTC', crypto, { volatility: 0.6, marketCap: undefined, traded: undefined }), profile('Expert', 'High')))).toBe(true);
    });
    it('fails a crypto asset that is not on the list', () => {
        const checks = run(signals('DOGE', crypto, { volatility: 0.6 }), profile('Expert', 'High'));
        expect(failed(checks)).toEqual([{ filter: 'crypto_risk', pass: false, detail: 'DOGE is not one of the crypto assets listed (BTC, ETH)' }]);
    });
});

describe('filters: missing data fails the candidate and names the value', () => {
    it('volatility', () => {
        const checks = run(signals('AAA', {}, { volatility: undefined }), medium);
        expect(failed(checks)).toEqual([{ filter: 'data', pass: false, detail: '1-year volatility is missing, so the volatility cap cannot be checked' }]);
    });
    it('market cap', () => {
        const checks = run(signals('AAA', {}, { marketCap: undefined }), medium);
        expect(failed(checks)).toEqual([{ filter: 'data', pass: false, detail: 'market cap is missing, so the market-cap floor cannot be checked' }]);
    });
    it('market cap for a Novice is reported once', () => {
        expect(failed(run(signals('AAA', {}, { marketCap: undefined }), profile('Novice', 'Medium')))).toHaveLength(1);
    });
    it('traded value', () => {
        const checks = run(signals('AAA', {}, { traded: undefined }), medium);
        expect(failed(checks)).toEqual([{ filter: 'data', pass: false, detail: 'average daily traded value is missing, so the liquidity minimum cannot be checked' }]);
    });
    it('everything at once', () => {
        const checks = run(signals('AAA', {}, { volatility: undefined, marketCap: undefined, traded: undefined }), medium);
        expect(failed(checks).map((check) => check.filter)).toEqual(['data', 'data', 'data']);
    });
    it('a value that is not a number counts as missing', () => {
        expect(failed(run(signals('AAA', {}, { volatility: Number.NaN }), medium))[0].filter).toBe('data');
    });
    it('crypto without volatility', () => {
        expect(failed(run(signals('BTC', crypto, { volatility: undefined }), profile('Expert', 'High'))).map((check) => check.filter)).toEqual(['data']);
    });
});

describe('checkProfileConflict', () => {
    it('returns the failed filters with the actual values', () => {
        const set = signals('MEME', { sector: 'Energy' }, { volatility: 0.412, marketCap: 1.5e9 });
        const { conflicts } = checkProfileConflict(set, profile('Intermediate', 'Medium', { avoid: ['Energy'] }), RULES, sourced(1.25));
        expect(conflicts.map((check) => [check.filter, check.detail])).toEqual([
            ['avoid_list', 'MEME is in Energy, a sector on the avoid list'],
            ['volatility', 'volatility 41.2% is above the 35.0% cap for Medium risk'],
            ['market_cap_floor', 'market cap US$1.5B is below the US$2.0B floor for Medium risk'],
        ]);
    });
    it('returns nothing when the asset passes every filter', () => {
        expect(checkProfileConflict(signals('AAA'), medium, RULES, sourced(1.25))).toEqual({ conflicts: [] });
    });
});
