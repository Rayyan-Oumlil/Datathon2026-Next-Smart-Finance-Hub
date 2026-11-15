import { describe, expect, it } from 'vitest';
import type { HoldingsSummary, Pick as WatchlistPick, SignalSet } from '@/lib/domain/types';
import { RULES } from '@/lib/rules';
import { buildReason as build, containsNeverWord } from '@/lib/watchlist/reasons';
import { EMPTY_HOLDINGS, profile, signals, withoutTextRefs } from './fixtures';

const buildReason = (...args: Parameters<typeof build>) => withoutTextRefs(build(...args));

function pick(set: SignalSet): WatchlistPick {
    const detail = { score: 50, detail: 'fixture' };
    return {
        rank: 1,
        symbol: set.symbol,
        name: set.entry.name,
        assetClass: set.entry.assetClass,
        sector: set.entry.sector,
        total: 50,
        factors: { profile_fit: detail, risk_fit: detail, fundamentals: detail, diversification: detail },
        topDrivers: ['profile_fit', 'risk_fit'],
        reason: null,
        signals: set,
    };
}

const IT = 'Information Technology';
const holding: HoldingsSummary = { totalValueCad: 10000, bySector: { [IT]: 2000 }, byAssetClass: { stock: 2000 }, symbols: ['MSFT', 'ADBE', 'XOM'] };
const sectorOf = { MSFT: IT, ADBE: IT, XOM: 'Energy', AAA: IT };
const etfEntry = { assetClass: 'etf' as const, sector: undefined, subIndustry: undefined, etf: { index: 'S&P 500', holdings: 503, issuerUrl: 'https://issuer.example/spx' } };

describe('reasons: never-words', () => {
    it('finds each listed word, whole word, any case', () => {
        for (const word of RULES.reasons.never_words) {
            expect(containsNeverWord(`It says ${word} here`), word).toBe(true);
            expect(containsNeverWord(`${word.toUpperCase()}.`), word).toBe(true);
        }
    });
    it.each([
        'buying', 'buys', 'Buys', 'sells', 'selling', 'recommend', 'recommends', 'recommending', 'Recommendation', 'recommended',
        'goods', 'safer', 'safest', 'safely', 'will rise', 'will  rises', 'fit you', 'fits you', 'a must-buy', 'SELL!', '(should)',
    ])('finds the inflection "%s"', (text) => {
        expect(containsNeverWord(text)).toBe(true);
    });
    it.each([
        'In Information Technology, a sector you picked', 'Same sector as MSFT, which you hold', 'On your brands list', 'ETF that tracks S&P 500', 'Moved +1.2% today',
        'Goodyear', 'shoulder', 'safety', 'buyout', 'sellout', 'will not rise', 'unsafe', 'willing', 'arise', '',
    ])('does not flag "%s"', (text) => {
        expect(containsNeverWord(text)).toBe(false);
    });
});

describe('reasons: the templates match the rules file', () => {
    it('has exactly the five allowed templates, in priority order', () => {
        expect(RULES.reasons.allowed_templates.map((template) => template.id)).toEqual(['same_sector_as_holding', 'picked_sector', 'brands_list', 'etf_tracks', 'moved']);
    });
    it('fills each one with the wording of the rules file', () => {
        const text = (id: string) => RULES.reasons.allowed_templates.find((template) => template.id === id)!.text;
        const everything = profile('Expert', 'Medium', { sectors: [IT], brands: ['AAA'] });
        const stock = pick(signals('AAA', {}, { change: 1.23 }));
        const only = (id: string, target: WatchlistPick) => {
            const rules = structuredClone(RULES);
            rules.reasons.allowed_templates = rules.reasons.allowed_templates.filter((template) => template.id === id);
            return buildReason(target, everything, holding, { sectorOf, rules })!.text;
        };
        expect(only('same_sector_as_holding', stock)).toBe(text('same_sector_as_holding').replace('{ticker}', 'ADBE'));
        expect(only('picked_sector', stock)).toBe(text('picked_sector').replace('{sector}', IT));
        expect(only('brands_list', stock)).toBe(text('brands_list'));
        expect(only('etf_tracks', pick(signals('SPX', etfEntry)))).toBe(text('etf_tracks').split(' / ')[0].replace('{index}', 'S&P 500'));
        expect(only('moved', stock)).toBe(text('moved').split(' / ')[0].replace('{x}', '+1.2'));
    });
    it('uses no template that the rules file does not allow', () => {
        const rules = structuredClone(RULES);
        rules.reasons.allowed_templates = [];
        expect(buildReason(pick(signals('AAA', {}, { change: 1 })), profile('Expert', 'Medium', { sectors: [IT], brands: ['AAA'] }), holding, { sectorOf, rules })).toBeNull();
    });
});

describe('reasons: priority order', () => {
    const everything = profile('Expert', 'Medium', { sectors: [IT], brands: ['AAA'] });
    const stock = pick(signals('AAA', {}, { change: -0.84 }));

    it('1. same sector as a holding (first held ticker A-Z in that sector)', () => {
        expect(buildReason(stock, everything, holding, { sectorOf })).toEqual({
            templateId: 'same_sector_as_holding', text: 'Same sector as ADBE, which you hold', sources: ['simulated holdings', 'hand-built test list'],
        });
    });
    it('does not name the pick itself as the holding', () => {
        const held: HoldingsSummary = { ...holding, symbols: ['AAA'] };
        expect(buildReason(stock, everything, held, { sectorOf })!.templateId).toBe('picked_sector');
    });
    it('2. picked sector, when no holding shares the sector', () => {
        expect(buildReason(stock, everything, EMPTY_HOLDINGS, { sectorOf })).toEqual({
            templateId: 'picked_sector', text: 'In Information Technology, a sector you picked', sources: ['Profile config'],
        });
    });
    it('cannot use the same-sector template without the sector of the held symbols', () => {
        expect(buildReason(stock, everything, holding)!.templateId).toBe('picked_sector');
    });
    it('3. brands list', () => {
        expect(buildReason(stock, profile('Expert', 'Medium', { brands: ['aaa'] }), EMPTY_HOLDINGS)).toEqual({
            templateId: 'brands_list', text: 'On your brands list', sources: ['Profile config'],
        });
    });
    it('4. ETF facts: the index, with the issuer page as source', () => {
        const fund = pick(signals('SPX', etfEntry, { change: 0.4 }));
        expect(buildReason(fund, profile('Expert', 'Medium'), EMPTY_HOLDINGS)).toEqual({
            templateId: 'etf_tracks', text: 'ETF that tracks S&P 500', sources: ['https://issuer.example/spx'],
        });
        expect(buildReason(fund, profile('Expert', 'Medium', { brands: ['SPX'] }), EMPTY_HOLDINGS)!.templateId).toBe('brands_list');
    });
    it('4. ETF facts: the number of companies when no index is on file', () => {
        const fund = pick(signals('ALL', { ...etfEntry, etf: { index: '', holdings: 9500, issuerUrl: 'https://issuer.example/all' } }));
        expect(buildReason(fund, profile('Expert', 'Medium'), EMPTY_HOLDINGS)!.text).toBe('ETF that holds 9500 companies');
    });
    it('5. the move today, with the quote source', () => {
        expect(buildReason(stock, profile('Expert', 'Medium'), EMPTY_HOLDINGS)).toEqual({ templateId: 'moved', text: 'Moved -0.8% today', sources: ['quote fixture'] });
        expect(buildReason(pick(signals('AAA', {}, { change: 2.25 })), profile('Expert', 'Medium'), EMPTY_HOLDINGS)!.text).toBe('Moved +2.3% today');
        expect(buildReason(pick(signals('AAA', {}, { change: 0 })), profile('Expert', 'Medium'), EMPTY_HOLDINGS)!.text).toBe('Moved 0.0% today');
    });
    it('5. the move over 1 month when there is no quote change but there are closes', () => {
        expect(buildReason(pick(signals('AAA', {}, { closes: [100, 104, 110] })), profile('Expert', 'Medium'), EMPTY_HOLDINGS)).toEqual({
            templateId: 'moved', text: 'Moved +10.0% over 1 month', sources: ['closes fixture'],
        });
    });
    it('returns null when no template has its data', () => {
        expect(buildReason(pick(signals('AAA')), profile('Expert', 'Medium'), EMPTY_HOLDINGS)).toBeNull();
        expect(buildReason(pick(signals('AAA', {}, { closes: [100] })), profile('Expert', 'Medium'), EMPTY_HOLDINGS)).toBeNull();
        expect(buildReason(pick(signals('FUND', { assetClass: 'etf', sector: undefined })), profile('Expert', 'Medium'), EMPTY_HOLDINGS)).toBeNull();
    });
});

describe('reasons: no output can contain a never-word', () => {
    it('skips a sentence whose data spells one (tickers SAFE and GOOD exist) and falls through', () => {
        const held: HoldingsSummary = { ...holding, symbols: ['SAFE'] };
        const reason = buildReason(pick(signals('AAA')), profile('Expert', 'Medium', { sectors: [IT] }), held, { sectorOf: { SAFE: IT } });
        expect(reason).toEqual({ templateId: 'picked_sector', text: 'In Information Technology, a sector you picked', sources: ['Profile config'] });
    });
    it('returns null when every applicable sentence would contain one', () => {
        const fund = pick(signals('FUND', { ...etfEntry, etf: { index: 'Safe Buy 50', issuerUrl: 'https://issuer.example' } }));
        expect(buildReason(fund, profile('Expert', 'Medium'), EMPTY_HOLDINGS)).toBeNull();
    });
    it('holds for every combination of hostile and ordinary data', () => {
        const words = ['Good', 'SAFE', 'Buy', 'Sell', 'Should', 'Recommended', 'will rise', 'fits you', 'Goods', 'Selling', IT, 'Energy', 'AAA', 'S&P 500'];
        let sentences = 0;
        for (const sector of words) {
            for (const other of words) {
                const stock = pick(signals(other, { sector }, { change: 1.5 }));
                const fund = pick(signals('FUND', { ...etfEntry, sector: undefined, etf: { index: other, holdings: 10, issuerUrl: 'https://issuer.example' } }));
                const who = profile('Expert', 'Medium', { sectors: [sector], brands: [other] });
                const held: HoldingsSummary = { totalValueCad: 1, bySector: { [sector]: 1 }, byAssetClass: { stock: 1 }, symbols: [sector, other, 'GOOD'] };
                const map = { [sector]: sector, [other]: sector, GOOD: sector };
                for (const target of [stock, fund]) {
                    for (const who2 of [who, profile('Expert', 'Medium')]) {
                        for (const holdings of [held, EMPTY_HOLDINGS]) {
                            const reason = buildReason(target, who2, holdings, { sectorOf: map });
                            if (reason) {
                                sentences++;
                                expect(containsNeverWord(reason.text), reason.text).toBe(false);
                            }
                        }
                    }
                }
            }
        }
        expect(sentences).toBeGreaterThan(500);
    });
});
