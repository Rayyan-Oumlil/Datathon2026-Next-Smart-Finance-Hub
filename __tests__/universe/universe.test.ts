import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import universeFile from '@/data/universe.json';
import canadaFile from '@/data/canada-tickers.json';
import etfFile from '@/data/blue-chip-etfs.json';
import themesFile from '@/data/themes.json';
import esgFile from '@/data/esg-demo.json';
import usFile from '@/data/us-tickers.json';
import {
    ESG_NOTE, UNIVERSE_INFO, getEntry, getUniverse, listNiches, listSectors, listThemes, searchUniverse, themeBasis,
} from '@/lib/universe';

const GICS_SECTORS = [
    'Communication Services', 'Consumer Discretionary', 'Consumer Staples', 'Energy', 'Financials', 'Health Care',
    'Industrials', 'Information Technology', 'Materials', 'Real Estate', 'Utilities',
];

// Mirrors UniverseEntry in lib/domain/types.ts; strict, so an unknown field fails.
const entrySchema = z.object({
    symbol: z.string().regex(/^[A-Z0-9]+([.-][A-Z]+)*$/),
    name: z.string().min(1),
    assetClass: z.enum(['stock', 'etf', 'crypto', 'gold', 'bond_yield']),
    market: z.enum(['US', 'Canada', 'none']),
    sector: z.string().optional(),
    subIndustry: z.string().optional(),
    themes: z.array(z.enum(['AI', 'clean energy', 'dividends'])),
    esg: z.enum(['screened', 'not screened', 'controversy']),
    blueChipEtf: z.boolean().optional(),
    etf: z.object({ index: z.string().min(1), holdings: z.number().optional(), issuerUrl: z.string().url() }).strict().optional(),
    listSource: z.string().min(10),
}).strict();

const universe = getUniverse();
const stocks = universe.filter((e) => e.assetClass === 'stock');
const etfs = universe.filter((e) => e.assetClass === 'etf');
const symbols = new Set(universe.map((e) => e.symbol));

describe('data/universe.json', () => {
    it('every entry matches the UniverseEntry shape', () => {
        for (const entry of universe) {
            const parsed = entrySchema.safeParse(entry);
            expect(parsed.success, `${entry.symbol}: ${parsed.success ? '' : parsed.error.message}`).toBe(true);
        }
    });

    it('symbols are unique', () => {
        expect(symbols.size).toBe(universe.length);
    });

    it('is dated and every source has a URL, a date and a licence', () => {
        expect(Number.isNaN(Date.parse(UNIVERSE_INFO.generated))).toBe(false);
        expect(UNIVERSE_INFO.usRankDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(UNIVERSE_INFO.sources.length).toBeGreaterThan(0);
        for (const source of UNIVERSE_INFO.sources) {
            expect(source.url, source.id).toBeTruthy();
            expect(source.date, source.id).toBeTruthy();
            expect(source.licence, source.id).toBeTruthy();
        }
    });

    it('stores no market cap and no price', () => {
        expect(JSON.stringify(universeFile.entries)).not.toMatch(/marketCap|price/i);
    });

    it('every stock has a GICS sector and every sector has entries in both markets combined', () => {
        for (const stock of stocks) expect(GICS_SECTORS, stock.symbol).toContain(stock.sector);
        expect(listSectors().map((s) => s.sector)).toEqual(GICS_SECTORS);
        for (const { sector, count } of listSectors()) expect(count, sector).toBeGreaterThan(0);
    });

    it('keeps at most 12 US stocks per sector, all from data/us-tickers.json with their sector', () => {
        const us = new Map(usFile.tickers.map((t) => [t.symbol, t]));
        const perSector = new Map<string, number>();
        for (const stock of stocks.filter((s) => s.market === 'US')) {
            expect(us.get(stock.symbol)?.sector, stock.symbol).toBe(stock.sector);
            expect(us.get(stock.symbol)?.subIndustry, stock.symbol).toBe(stock.subIndustry);
            perSector.set(stock.sector!, (perSector.get(stock.sector!) ?? 0) + 1);
        }
        expect([...perSector.keys()].sort()).toEqual(GICS_SECTORS);
        for (const [sector, count] of perSector) expect(count, sector).toBeLessThanOrEqual(12);
    });

    it('Canadian symbols end in .TO, US ones do not, and class shares use a dash', () => {
        for (const entry of universe) {
            if (entry.market === 'Canada') expect(entry.symbol).toMatch(/^[A-Z]+(-[A-Z]+)?\.TO$/);
            else expect(entry.symbol.endsWith('.TO'), entry.symbol).toBe(false);
        }
    });

    it('Canadian stocks are exactly the Wikipedia table, described as the article and not as the index', () => {
        const canadian = stocks.filter((s) => s.market === 'Canada');
        expect(canadian.map((s) => s.symbol).sort()).toEqual(canadaFile.tickers.map((t) => t.symbol).sort());
        expect(canadaFile.source.revisionId).toBeGreaterThan(0);
        expect(Number.isNaN(Date.parse(canadaFile.source.revisionDate))).toBe(false);
        expect(canadaFile.source.licence).toContain('CC BY-SA 4.0');
        expect(canadaFile.description).toContain(`at revision ${canadaFile.source.revisionId}`);
        const mapping: Record<string, string> = canadaFile.sectorMapping.map;
        for (const ticker of canadaFile.tickers) {
            expect(ticker.symbol).toBe(`${ticker.tsxSymbol.replace(/\./g, '-')}.TO`);
            expect(mapping[ticker.wikipediaSector], ticker.symbol).toBe(ticker.sector);
        }
        for (const stock of canadian) {
            expect(stock.subIndustry, stock.symbol).toBeUndefined();
            expect(stock.listSource).toContain(`rev ${canadaFile.source.revisionId}`);
        }
    });

    it('every ETF has the index it tracks and its issuer page, verified by the builder', () => {
        expect(etfs.length).toBeGreaterThan(0);
        for (const etf of etfs) {
            expect(etf.etf?.index, etf.symbol).toBeTruthy();
            expect(etf.etf?.issuerUrl, etf.symbol).toMatch(/^https:\/\//);
            expect(typeof etf.blueChipEtf, etf.symbol).toBe('boolean');
            expect(etf.sector, etf.symbol).toBeUndefined();
            const check = universeFile.fundChecks.find((c) => c.symbol === etf.symbol);
            expect(check?.ok, etf.symbol).toBe(true);
            const listed = etfFile.etfs.find((e) => e.symbol === etf.symbol);
            expect(listed?.index).toBe(etf.etf?.index);
            expect(listed?.blueChipEtf).toBe(etf.blueChipEtf);
        }
    });

    it('has blue-chip ETFs in both markets and some that are not blue-chip', () => {
        expect(etfs.filter((e) => e.blueChipEtf && e.market === 'US').length).toBeGreaterThan(0);
        expect(etfs.filter((e) => e.blueChipEtf && e.market === 'Canada').length).toBeGreaterThan(0);
        expect(etfs.filter((e) => !e.blueChipEtf).length).toBeGreaterThan(0);
    });

    it('holds crypto, gold and the three bond yields with market none', () => {
        const expected: Record<string, string> = { BTC: 'crypto', ETH: 'crypto', GOLD: 'gold', CA2Y: 'bond_yield', CA5Y: 'bond_yield', CA10Y: 'bond_yield' };
        for (const [symbol, assetClass] of Object.entries(expected)) {
            expect(getEntry(symbol)?.assetClass, symbol).toBe(assetClass);
            expect(getEntry(symbol)?.market, symbol).toBe('none');
        }
        expect(universe.filter((e) => e.market === 'none').length).toBe(6);
    });
});

describe('data/themes.json', () => {
    it('says membership is hand-set and names only symbols and sub-industries that exist', () => {
        expect(themesFile.note).toContain('hand-set');
        const subIndustries = new Set(universe.map((e) => e.subIndustry));
        const dropped = new Set(universeFile.fundChecks.filter((c) => !c.ok).map((c) => c.symbol));
        for (const theme of themesFile.themes) {
            for (const { symbol, basis } of theme.symbols) {
                if (!dropped.has(symbol)) expect(symbols.has(symbol), `${theme.id}: ${symbol}`).toBe(true);
                expect(basis.length).toBeGreaterThan(10);
            }
            for (const { name } of theme.subIndustries) expect(subIndustries.has(name), `${theme.id}: ${name}`).toBe(true);
        }
    });

    it('every theme has members and every tagged entry has a stated basis', () => {
        expect(listThemes().map((t) => t.theme)).toEqual(['AI', 'clean energy', 'dividends']);
        for (const { theme, count, symbols: members } of listThemes()) {
            expect(count, theme).toBeGreaterThan(0);
            for (const symbol of members) expect(themeBasis(symbol, theme), `${theme}: ${symbol}`).toBeTruthy();
        }
        expect(themeBasis('BTC', 'AI')).toBeUndefined();
    });
});

describe('data/esg-demo.json', () => {
    it('is labelled as a mock', () => {
        expect(ESG_NOTE).toBe('demo data: hand-set mock tags, not real ESG data');
    });

    it('tags exactly the symbols of the universe, with the same tag as the entry', () => {
        const tags: Record<string, string> = esgFile.tags;
        expect(Object.keys(tags).sort()).toEqual([...symbols].sort());
        for (const entry of universe) expect(tags[entry.symbol], entry.symbol).toBe(entry.esg);
    });

    it('follows its own written rules', () => {
        const { controversy, notScreened } = esgFile.rules;
        for (const entry of universe) {
            const expected = controversy.symbols.includes(entry.symbol) ? 'controversy'
                : notScreened.sectors.includes(entry.sector ?? '') || notScreened.subIndustries.includes(entry.subIndustry ?? '')
                    || notScreened.assetClasses.includes(entry.assetClass) ? 'not screened' : 'screened';
            expect(entry.esg, entry.symbol).toBe(expected);
        }
        for (const tag of ['screened', 'not screened', 'controversy']) {
            expect(universe.some((e) => e.esg === tag), tag).toBe(true);
        }
    });
});

describe('lib/universe', () => {
    it('getEntry finds a symbol in any case and class shares in either form', () => {
        expect(getEntry(' aapl ')?.symbol).toBe('AAPL');
        expect(getEntry('ry.to')?.name).toBe('Royal Bank of Canada');
        expect(getEntry('CTC.A.TO')?.symbol).toBe('CTC-A.TO');
        expect(getEntry('NOT-A-SYMBOL')).toBeUndefined();
    });

    it('listSectors counts every stock once', () => {
        expect(listSectors().reduce((sum, s) => sum + s.count, 0)).toBe(stocks.length);
    });

    it('listNiches returns the sub-industries of one sector', () => {
        const niches = listNiches('Information Technology');
        expect(niches.length).toBeGreaterThan(0);
        expect(niches.every((n) => n.sector === 'Information Technology')).toBe(true);
        expect(niches.map((n) => n.niche)).toContain('Semiconductors');
        expect(listNiches().reduce((sum, n) => sum + n.count, 0)).toBe(stocks.filter((s) => s.subIndustry).length);
        expect(listNiches('No such sector')).toEqual([]);
    });

    it('searchUniverse puts the exact symbol first and matches names', () => {
        expect(searchUniverse('ry')[0].symbol).toBe('RY.TO');
        expect(searchUniverse('royal bank').map((e) => e.symbol)).toContain('RY.TO');
        expect(searchUniverse('bitcoin')[0].symbol).toBe('BTC');
        expect(searchUniverse('')).toEqual([]);
        expect(searchUniverse('zzzzzz')).toEqual([]);
        expect(searchUniverse('a', 5).length).toBe(5);
        expect(searchUniverse('a', 5)).toEqual(searchUniverse('a', 5));
    });
});
