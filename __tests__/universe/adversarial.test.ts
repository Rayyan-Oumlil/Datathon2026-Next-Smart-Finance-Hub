import { describe, expect, it } from 'vitest';
import universeFile from '@/data/universe.json';
import etfFile from '@/data/blue-chip-etfs.json';
import esgFile from '@/data/esg-demo.json';
import rules from '@/rules/v1.json';
import { UNIVERSE_INFO, getEntry, getUniverse, listNiches, listSectors, listThemes, searchUniverse, themeBasis } from '@/lib/universe';

const symbolsOf = (q: string, limit?: number) => searchUniverse(q, limit).map((e) => e.symbol);

describe('universe against rules/v1.json', () => {
    it('crypto rows are exactly the assets the rules name', () => {
        const crypto = getUniverse().filter((e) => e.assetClass === 'crypto').map((e) => e.symbol).sort();
        expect(crypto).toEqual([...rules.filters.asset_class_rules.crypto.assets].sort());
    });

    it('every ESG tag is one the rules allow', () => {
        for (const entry of getUniverse()) expect(rules.filters.esg.tags, entry.symbol).toContain(entry.esg);
    });

    it('blue-chip funds track a broad index, the others do not', () => {
        const broad = /S&P 500 Index|Total Market Index|S&P\/TSX 60 Index|S&P\/TSX Capped Composite Index|All Cap Index/;
        for (const etf of getUniverse().filter((e) => e.assetClass === 'etf')) {
            expect(broad.test(etf.etf!.index), `${etf.symbol}: ${etf.etf!.index}`).toBe(etf.blueChipEtf);
        }
    });

    it('each fund was checked at the URL it carries, and funds the builder could not verify are absent', () => {
        for (const etf of getUniverse().filter((e) => e.assetClass === 'etf')) {
            const check = universeFile.fundChecks.find((c) => c.symbol === etf.symbol)! as typeof universeFile.fundChecks[number] & { method?: string; note?: string };
            expect(check.url).toBe(etf.etf!.issuerUrl);
            // A fund entered by hand is allowed only when it says so and why (its issuer page could not be read)
            if (check.method === 'manual') { expect(check.note, etf.symbol).toBeTruthy(); continue; }
            expect(check.httpStatus).toBe(200);
            expect(check.namesIndex && check.namesTicker).toBe(true);
            expect(Number.isNaN(Date.parse(check.checkedAt))).toBe(false);
        }
        for (const { symbol } of etfFile.notListed) expect(getEntry(symbol), symbol).toBeUndefined();
    });

    it('every source link is an https URL or a file in the repo', () => {
        for (const source of UNIVERSE_INFO.sources) expect(source.url, source.id).toMatch(/^(https:\/\/\S+|(data|rules)\/[\w.-]+\.json)$/);
    });

    it('every row says where it came from, and Wikipedia rows carry the licence', () => {
        for (const entry of getUniverse()) {
            expect(entry.listSource.length, entry.symbol).toBeGreaterThan(20);
            if (/Wikipedia/.test(entry.listSource)) expect(entry.listSource, entry.symbol).toContain('CC BY-SA 4.0');
        }
    });

    it('no company is listed twice under a US and a Canadian line', () => {
        const canadian = new Set(getUniverse().filter((e) => e.market === 'Canada').map((e) => e.symbol.replace(/\.TO$/, '')));
        const clash = getUniverse().filter((e) => e.market === 'US' && canadian.has(e.symbol) && e.name.split(' ')[0] === getEntry(`${e.symbol}.TO`)!.name.split(' ')[0]);
        expect(clash.map((e) => e.symbol)).toEqual([]);
    });

    it('the mock controversy label is declared arbitrary', () => {
        expect(esgFile.rules.controversy.basis).toMatch(/implies nothing about the real company/);
    });
});

describe('lib/universe with odd input', () => {
    it('getEntry returns undefined for empty or meaningless symbols', () => {
        for (const q of ['', '   ', '.TO', '-', '.', '__proto__', 'constructor', 'AAPL.TO', 'RY']) expect(getEntry(q), JSON.stringify(q)).toBeUndefined();
    });

    it('getEntry keeps US and Canadian lines apart', () => {
        expect(getEntry('t')?.name).toBe('AT&T');
        expect(getEntry('t.to')?.name).toBe('Telus Corporation');
        expect(getEntry('brk-b')?.symbol).toBe('BRK.B');
        expect(getEntry('bip.un.to')?.symbol).toBe('BIP-UN.TO');
        expect(getEntry('ca10y')?.assetClass).toBe('bond_yield');
    });

    it('searchUniverse finds class shares in either written form', () => {
        expect(symbolsOf('ctc.a')[0]).toBe('CTC-A.TO');
        expect(symbolsOf('CTC.A.TO')[0]).toBe('CTC-A.TO');
        expect(symbolsOf('brk-b')[0]).toBe('BRK.B');
        expect(symbolsOf('brk.b')[0]).toBe('BRK.B');
    });

    it('searchUniverse survives odd text and limits', () => {
        for (const q of ['(', '[a-z', '\\', '*', '&', '   ', '.to']) expect(() => searchUniverse(q)).not.toThrow();
        expect(symbolsOf('at&t')).toEqual(['T']);
        expect(symbolsOf('t')[0]).toBe('T');
        expect(symbolsOf('t').slice(0, 2).sort()).toEqual(['T', 'T.TO']);
        expect(searchUniverse('a', 0)).toEqual([]);
        expect(searchUniverse('a', -1)).toEqual([]);
        expect(searchUniverse('a', Number.NaN)).toEqual([]);
        expect(new Set(symbolsOf('a', 500)).size).toBe(symbolsOf('a', 500).length);
    });

    it('a caller that sorts or empties a result does not change the universe', () => {
        const before = getUniverse().map((e) => e.symbol);
        getUniverse().reverse();
        getUniverse().length = 0;
        listSectors().length = 0;
        listThemes()[0].symbols.length = 0;
        expect(getUniverse().map((e) => e.symbol)).toEqual(before);
        expect(listSectors().length).toBe(11);
        expect(listThemes()[0].count).toBe(listThemes()[0].symbols.length);
    });

    it('listNiches and themeBasis return nothing for unknown input', () => {
        expect(listNiches('')).toEqual(listNiches());
        expect(listNiches('information technology')).toEqual([]);
        expect(themeBasis('NVDA', 'ESG')).toBeUndefined();
        expect(themeBasis('NOPE', 'AI')).toBeUndefined();
        expect(themeBasis('AAPL', 'AI')).toBeUndefined();
        expect(themeBasis('nvda', 'AI')).toContain('Semiconductors');
    });
});
