import { describe, expect, it } from 'vitest';
import { selectCandidates } from '@/lib/watchlist/universe-select';
import { entry, profile, shuffled } from './fixtures';

const universe = [
    entry('CHIP', { sector: 'Information Technology', subIndustry: 'Semiconductors' }),
    entry('SOFT', { sector: 'Information Technology', subIndustry: 'Application Software', themes: ['AI'] }),
    entry('BANK', { sector: 'Financials', subIndustry: 'Diversified Banks', themes: ['dividends'] }),
    entry('BANK.TO', { sector: 'Financials', subIndustry: 'Diversified Banks', market: 'Canada', themes: ['dividends'] }),
    entry('OIL', { sector: 'Energy', subIndustry: 'Integrated Oil & Gas' }),
    entry('OIL.TO', { sector: 'Energy', subIndustry: 'Integrated Oil & Gas', market: 'Canada' }),
    entry('SPX', { assetClass: 'etf', sector: undefined, subIndustry: undefined, blueChipEtf: true }),
    entry('DIV.TO', { assetClass: 'etf', sector: undefined, subIndustry: undefined, market: 'Canada', themes: ['dividends'] }),
    entry('BTC', { assetClass: 'crypto', market: 'none', sector: undefined, subIndustry: undefined }),
    entry('ETH', { assetClass: 'crypto', market: 'none', sector: undefined, subIndustry: undefined }),
    entry('GOLD', { assetClass: 'gold', market: 'none', sector: undefined, subIndustry: undefined }),
    entry('CA5Y', { assetClass: 'bond_yield', market: 'none', sector: undefined, subIndustry: undefined }),
];
const ALWAYS = ['BTC', 'CA5Y', 'ETH', 'GOLD'];
const symbols = (over: Parameters<typeof profile>[2]) => selectCandidates(universe, profile('Intermediate', 'Medium', over)).candidates.map((e) => e.symbol);

describe('selectCandidates', () => {
    it('takes every stock and ETF of the picked market when no sector, niche or theme was picked', () => {
        expect(symbols({ markets: 'US' })).toEqual(['BANK', 'BTC', 'CA5Y', 'CHIP', 'ETH', 'GOLD', 'OIL', 'SOFT', 'SPX']);
        expect(symbols({ markets: 'Canada' })).toEqual(['BANK.TO', 'BTC', 'CA5Y', 'DIV.TO', 'ETH', 'GOLD', 'OIL.TO']);
    });

    it('treats "global" as both markets', () => {
        expect(symbols({ markets: 'global' })).toEqual(universe.map((e) => e.symbol).sort());
    });

    it('takes the entries of a picked sector, in the picked market only', () => {
        expect(symbols({ markets: 'US', sectors: ['Energy'] })).toEqual([...ALWAYS, 'OIL'].sort());
        expect(symbols({ markets: 'global', sectors: ['energy'] })).toEqual([...ALWAYS, 'OIL', 'OIL.TO'].sort());
    });

    it('takes the entries of a picked niche', () => {
        expect(symbols({ markets: 'US', niches: ['Semiconductors'] })).toEqual([...ALWAYS, 'CHIP'].sort());
    });

    it('takes the entries tagged with a picked theme, ETFs included', () => {
        expect(symbols({ markets: 'global', themes: ['dividends'] })).toEqual([...ALWAYS, 'BANK', 'BANK.TO', 'DIV.TO'].sort());
        expect(symbols({ markets: 'US', themes: ['AI'] })).toEqual([...ALWAYS, 'SOFT'].sort());
    });

    it('combines sector, niche and theme picks without duplicates', () => {
        expect(symbols({ markets: 'US', sectors: ['Information Technology'], niches: ['Semiconductors'], themes: ['AI', 'dividends'] }))
            .toEqual([...ALWAYS, 'BANK', 'CHIP', 'SOFT'].sort());
    });

    it('always adds crypto, gold and bond yields', () => {
        for (const symbol of ALWAYS) expect(symbols({ markets: 'Canada', sectors: ['Energy'] })).toContain(symbol);
    });

    it('adds the brands as seeds, even outside the picked sectors and markets, and ignores unknown brands', () => {
        const result = selectCandidates(universe, profile('Intermediate', 'Medium', { markets: 'US', sectors: ['Energy'], brands: ['bank.to', 'CHIP', 'NOPE'] }));
        expect(result.seeds).toEqual(['BANK.TO', 'CHIP']);
        expect(result.candidates.map((e) => e.symbol)).toEqual([...ALWAYS, 'BANK.TO', 'CHIP', 'OIL'].sort());
    });

    it('does not depend on the order of the universe', () => {
        const picked = profile('Intermediate', 'Medium', { markets: 'global', sectors: ['Financials'], brands: ['SOFT'] });
        expect(selectCandidates(shuffled(universe), picked)).toEqual(selectCandidates(universe, picked));
    });
});
