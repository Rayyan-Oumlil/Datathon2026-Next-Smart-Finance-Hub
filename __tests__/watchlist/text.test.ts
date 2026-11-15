import { describe, expect, it } from 'vitest';
import type { HoldingsSummary, Pick as WatchlistPick, SignalSet, TextRef } from '@/lib/domain/types';
import { RULES } from '@/lib/rules';
import { runFilters } from '@/lib/watchlist/filters';
import { buildReason, containsNeverWord } from '@/lib/watchlist/reasons';
import { renderCheck, renderFactors, renderReason } from '@/lib/watchlist/render';
import { scoreCandidate } from '@/lib/watchlist/score';
import { SECTOR_NAMES_FR, WATCHLIST_TEXT, renderOr, renderText, type WatchlistParams, type WatchlistTextKey } from '@/lib/watchlist/text';
import { EMPTY_HOLDINGS, profile, signals, sourced } from './fixtures';

const NBSP = ' ';
const SECTORS = Object.keys(SECTOR_NAMES_FR);
const IT = 'Information Technology';

// Sample values for every sentence of the catalog, several per key so each branch is written at least once.
const SAMPLES: { [K in WatchlistTextKey]: Array<WatchlistParams<K>> } = {
    'filter.data.missing': [
        { what: 'market_cap', neededFor: 'market_cap_floor' }, { what: 'avg_traded_value', neededFor: 'liquidity_minimum' }, { what: 'volatility_1y', neededFor: 'volatility_cap' },
    ],
    'filter.data.fx_missing': [{ what: 'market_cap', neededFor: 'market_cap_floor' }, { what: 'avg_traded_value', neededFor: 'liquidity_minimum' }],
    'filter.data.volatility_negative': [{ value: -0.1 }],
    'filter.data.no_signals': [{ symbol: 'RY.TO' }],
    'filter.avoid.symbol': [{ symbol: 'AAPL' }],
    'filter.avoid.sector': SECTORS.map((sector) => ({ symbol: 'XOM', sector })),
    'filter.avoid.clear': [{ symbol: 'AAPL', sector: IT }, { symbol: 'BTC', sector: null }],
    'filter.markets.none': [{ symbol: 'GOLD', picked: 'global' }, { symbol: 'GOLD', picked: 'US' }],
    'filter.markets.listed': [{ symbol: 'KO', market: 'US', picked: 'Canada' }, { symbol: 'RY.TO', market: 'Canada', picked: 'global' }, { symbol: 'KO', market: 'US', picked: 'US' }],
    'filter.volatility': [
        { value: 0.412, limit: 0.35, pass: false, risk: 'Medium' }, { value: 0.35, limit: 0.35, pass: true, risk: 'Medium' },
        { value: 0.12, limit: 0.2, pass: true, risk: 'Low' }, { value: 0.3501, limit: 0.35, pass: false, risk: 'High' },
    ],
    'filter.market_cap_floor': [
        { value: 4e9, limit: 2e9, pass: true, risk: 'Medium' }, { value: 1999999999, limit: 2e9, pass: false, risk: 'Medium' },
        { value: 10e9, limit: 10e9, pass: true, risk: 'Low' }, { value: 3.5e12, limit: 3e8, pass: true, risk: 'High' },
    ],
    'filter.liquidity': [{ value: 1e6, limit: 1e6, pass: true }, { value: 999_999, limit: 1e6, pass: false }, { value: 2.5e8, limit: 1e6, pass: true }],
    'filter.esg.not_picked': [{ tag: 'controversy' }, { tag: 'screened' }, { tag: 'not screened' }],
    'filter.esg.picked': [{ tag: 'controversy' }, { tag: 'screened' }],
    'filter.novice.stock': [{ value: 10e9, limit: 10e9, pass: true }, { value: 10e9 - 1, limit: 10e9, pass: false }],
    'filter.blue_chip_etf': [
        { symbol: 'SPX', onList: true, who: 'novice' }, { symbol: 'ARKX', onList: false, who: 'novice' },
        { symbol: 'SPX', onList: true, who: 'low_risk' }, { symbol: 'ARKX', onList: false, who: 'low_risk' },
    ],
    'filter.crypto.not_listed': [{ symbol: 'DOGE', assets: ['BTC', 'ETH'] }],
    'filter.crypto.risk': [{ allowed: ['High'], risk: 'Medium' }, { allowed: ['High'], risk: 'High' }],
    'filter.crypto.novice': [{}],
    'factor.profile_fit': [
        { sector: IT, sectorPicked: false, sectorPoints: 40, niche: 'Semiconductors', nichePicked: false, nichePoints: 20, theme: null, themePoints: 20, onBrands: false, brandsPoints: 20, score: 0 },
        { sector: IT, sectorPicked: true, sectorPoints: 40, niche: 'Semiconductors', nichePicked: true, nichePoints: 20, theme: 'dividends', themePoints: 20, onBrands: true, brandsPoints: 20, score: 100 },
        { sector: null, sectorPicked: false, sectorPoints: 40, niche: null, nichePicked: false, nichePoints: 20, theme: 'AI', themePoints: 20, onBrands: false, brandsPoints: 20, score: 20 },
    ],
    'factor.risk_fit': [
        { state: 'missing', volatility: null, lower: 0.2, upper: 0.35, risk: 'Medium', score: 0 },
        { state: 'negative', volatility: -0.1, lower: 0.2, upper: 0.35, risk: 'Medium', score: 0 },
        { state: 'above', volatility: 0.5, lower: 0.2, upper: 0.35, risk: 'Medium', score: 0 },
        { state: 'inside', volatility: 0.3, lower: 0.2, upper: 0.35, risk: 'Medium', score: 100 },
        { state: 'below', volatility: 0.15, lower: 0.2, upper: 0.35, risk: 'Medium', score: 87.5 },
    ],
    'factor.fundamentals': [
        { pe: 25, peState: 'scored', ratio: 1.25, median: 20, count: 3, sector: IT, pePart: 50, growth: 20, growthPart: 100, parts: 2, score: 75 },
        { pe: -8, peState: 'not_positive', ratio: null, median: null, count: null, sector: IT, pePart: null, growth: 5, growthPart: 50, parts: 1, score: 50 },
        { pe: 25, peState: 'no_median', ratio: null, median: null, count: null, sector: IT, pePart: null, growth: null, growthPart: null, parts: 0, score: 50 },
        { pe: null, peState: 'missing', ratio: null, median: null, count: null, sector: null, pePart: null, growth: null, growthPart: null, parts: 0, score: 50 },
    ],
    'factor.diversification': [
        { group: 'sector', name: IT, state: 'not_held', share: null, threshold: 0.2, score: 100 },
        { group: 'asset_class', name: 'etf', state: 'not_held', share: null, threshold: 0.2, score: 100 },
        { group: 'sector', name: 'Energy', state: 'total_unknown', share: null, threshold: 0.2, score: 0 },
        { group: 'sector', name: IT, state: 'under', share: 0.1999, threshold: 0.2, score: 50 },
        { group: 'asset_class', name: 'crypto', state: 'not_under', share: 0.6, threshold: 0.2, score: 0 },
    ],
    'reason.same_sector_as_holding': [{ ticker: 'ADBE' }],
    'reason.picked_sector': SECTORS.map((sector) => ({ sector })),
    'reason.brands_list': [{}],
    'reason.etf_tracks': [{ index: 'S&P 500 Index', holdings: null }, { index: 'S&P/TSX 60', holdings: null }, { index: null, holdings: 9500 }],
    'reason.moved': [{ change: 1.23, window: 'today' }, { change: -0.84, window: 'today' }, { change: -0.04, window: 'today' }, { change: 10, window: '1m' }],
};

const all = (Object.keys(SAMPLES) as WatchlistTextKey[]).flatMap((key) => (SAMPLES[key] as Array<Record<string, unknown>>).map((params) => ({ key, params })));

describe('watchlist catalog: every sentence in both languages', () => {
    it('has samples for every key of the catalog', () => {
        expect(Object.keys(SAMPLES).sort()).toEqual(Object.keys(WATCHLIST_TEXT).sort());
    });

    it.each(all.map((item) => [item.key, JSON.stringify(item.params), item] as const))('%s %s', (_key, _json, { key, params }) => {
        const ref: TextRef = { key, params: params as TextRef['params'] };
        const en = renderText(ref, 'en');
        const fr = renderText(ref, 'fr');
        expect(en.trim().length).toBeGreaterThan(0);
        expect(fr.trim().length).toBeGreaterThan(0);
        expect(fr).not.toBe(en);
        // Never a forbidden word, in either language, against either list
        expect(containsNeverWord(en), en).toBe(false);
        expect(containsNeverWord(fr), fr).toBe(false);
        // French typography: no plain space before ":" or "%", no English decimal point in a figure
        expect(fr).not.toMatch(/ [:%]/);
        expect(fr).not.toMatch(/\d\.\d/);
        expect(fr).not.toMatch(/\bundefined\b|\bnull\b|NaN/);
        expect(en).not.toMatch(/\bundefined\b|\bnull\b|NaN/);
        // Pure: the same values give the same sentence
        expect(renderText(ref, 'fr')).toBe(fr);
    });

    it('writes French numbers with a decimal comma and a no-break space before %', () => {
        expect(renderText({ key: 'filter.volatility', params: { value: 0.412, limit: 0.35, pass: false, risk: 'Medium' } }, 'fr'))
            .toBe(`volatilité de 41,2${NBSP}%, au-dessus du plafond de 35,0${NBSP}% pour un profil de risque Moyen`);
        expect(renderText({ key: 'filter.volatility', params: { value: 0.3501, limit: 0.35, pass: false, risk: 'Medium' } }, 'fr'))
            .toBe(`volatilité de 35,01${NBSP}%, au-dessus du plafond de 35,00${NBSP}% pour un profil de risque Moyen`);
        expect(renderText({ key: 'filter.market_cap_floor', params: { value: 1.5e9, limit: 2e9, pass: false, risk: 'Low' } }, 'fr'))
            .toBe(`capitalisation boursière de 1,5${NBSP}G$${NBSP}US, sous le seuil de 2,0${NBSP}G$${NBSP}US pour un profil de risque Faible`);
        expect(renderText({ key: 'filter.liquidity', params: { value: 999_999, limit: 1e6, pass: false } }, 'fr'))
            .toBe(`valeur moyenne négociée de 999${NBSP}999${NBSP}$${NBSP}US par jour, sous le minimum de 1,0${NBSP}M$${NBSP}US par jour`);
        expect(renderText({ key: 'reason.moved', params: { change: -0.04, window: 'today' } }, 'fr')).toBe(`Variation de 0,0${NBSP}% aujourd’hui`);
    });

    it('keeps the English sentences exactly as before', () => {
        expect(renderText({ key: 'filter.volatility', params: { value: 0.412, limit: 0.35, pass: false, risk: 'Medium' } }, 'en'))
            .toBe('volatility 41.2% is above the 35.0% cap for Medium risk');
        expect(renderText({ key: 'filter.liquidity', params: { value: 999_999, limit: 1e6, pass: false } }, 'en'))
            .toBe('average traded value US$999,999 a day is below the US$1.0M a day minimum');
        expect(renderText({ key: 'reason.etf_tracks', params: { index: null, holdings: 9500 } }, 'en')).toBe('ETF that holds 9500 companies');
    });

    it('names levels, risks, asset classes and the 11 sectors in French, keeping the identifiers in the values', () => {
        const fr = (key: WatchlistTextKey, params: Record<string, unknown>) => renderText({ key, params: params as TextRef['params'] }, 'fr');
        expect(fr('filter.crypto.risk', { allowed: ['High'], risk: 'Low' })).toContain('Élevé');
        expect(fr('filter.crypto.risk', { allowed: ['High'], risk: 'Low' })).toContain('Faible');
        expect(fr('filter.blue_chip_etf', { symbol: 'SPX', onList: true, who: 'novice' })).toContain('niveau Novice');
        expect(fr('factor.diversification', { group: 'asset_class', name: 'etf', state: 'not_held', share: null, threshold: 0.2, score: 100 })).toContain('FNB');
        expect(SECTORS).toHaveLength(11);
        for (const sector of SECTORS) expect(fr('reason.picked_sector', { sector })).toBe(`Dans le secteur ${SECTOR_NAMES_FR[sector]}, que vous avez choisi`);
        // A sector the mapping does not know is shown as the source wrote it
        expect(fr('reason.picked_sector', { sector: 'Space Mining' })).toBe('Dans le secteur Space Mining, que vous avez choisi');
        // A sub-industry is the source's own label, quoted as given
        expect(fr('factor.profile_fit', SAMPLES['factor.profile_fit'][1])).toContain(`créneau «${NBSP}Semiconductors${NBSP}» choisi`);
    });

    it('falls back to the stored text for a key it does not know or values it cannot use', () => {
        expect(renderOr({ key: 'filter.retired' }, 'fr', 'as logged')).toBe('as logged');
        expect(renderOr(undefined, 'fr', 'as logged')).toBe('as logged');
        expect(renderOr({ key: 'filter.crypto.not_listed', params: {} }, 'fr', 'as logged')).toBe('as logged');
        expect(() => renderText({ key: 'filter.retired' }, 'en')).toThrow();
    });
});

describe('producers: the language changes the words, never the result', () => {
    const cases: Array<[string, SignalSet, ReturnType<typeof profile>]> = [
        ['stock that fails three filters', signals('MEME', { sector: 'Energy' }, { volatility: 0.412, marketCap: 1.5e9, traded: 0.5e6 }), profile('Novice', 'Medium', { avoid: ['Energy'], themes: ['ESG'] })],
        ['ETF for a Low risk Novice', signals('ARKX', { assetClass: 'etf', sector: undefined, subIndustry: undefined }, { marketCap: undefined }), profile('Novice', 'Low')],
        ['crypto', signals('DOGE', { assetClass: 'crypto', market: 'none', sector: undefined, subIndustry: undefined }), profile('Novice', 'Medium')],
        ['CAD value with no rate', (() => { const set = signals('RY.TO', { market: 'Canada' }); set.marketCapUsd = sourced(12.5e9, { currency: 'CAD' }); return set; })(), profile('Expert', 'Low', { markets: 'US' })],
    ];

    it.each(cases)('filters: %s', (_name, set, who) => {
        const en = runFilters(set, who, RULES, undefined, 'en');
        const fr = runFilters(set, who, RULES, undefined, 'fr');
        expect(fr.map(({ filter, pass, value, limit, textRef }) => ({ filter, pass, value, limit, textRef }))).toEqual(en.map(({ filter, pass, value, limit, textRef }) => ({ filter, pass, value, limit, textRef })));
        // An English check rendered in French is the French check
        expect(en.map((check) => renderCheck(check, 'fr'))).toEqual(fr);
        expect(fr.map((check) => renderCheck(check, 'en'))).toEqual(en);
    });

    it('score: same scores, details rendered from the same values', () => {
        const set = signals('CHIP', { subIndustry: 'Semiconductors', themes: ['AI'] }, { volatility: 0.15, pe: 25, growth: 20 });
        const holdings: HoldingsSummary = { totalValueCad: 10000, bySector: { [IT]: 1999 }, byAssetClass: { stock: 1999 }, symbols: ['MSFT'] };
        const context = { sectorMedianPe: { [IT]: { median: 20, count: 3 } }, holdings };
        const who = profile('Expert', 'Medium', { sectors: [IT], themes: ['AI'] });
        const en = scoreCandidate(set, who, RULES, { ...context, locale: 'en' });
        const fr = scoreCandidate(set, who, RULES, { ...context, locale: 'fr' });
        expect(fr.total).toBe(en.total);
        expect(fr.topDrivers).toEqual(en.topDrivers);
        expect(renderFactors(en.factors, 'fr')).toEqual(fr.factors);
        expect(fr.factors.fundamentals.detail).toBe('C/B de 25,0, soit 1,25 fois la médiane de 20,0 des 3 candidat(s) du secteur Technologies de l’information ayant un C/B dans cet instantané : 50,0; croissance des revenus de 20,0 % sur un an : 100,0; moyenne des deux : 75,0');
        expect(fr.factors.diversification.detail).toBe('le portefeuille simulé contient le secteur Technologies de l’information, qui représente 19,99 % de sa valeur, sous 20 % : 50');
    });
});

describe('reasons in French', () => {
    const pick = (set: SignalSet): WatchlistPick => {
        const detail = { score: 50, detail: 'fixture' };
        return {
            rank: 1, symbol: set.symbol, name: set.entry.name, assetClass: set.entry.assetClass, sector: set.entry.sector, total: 50,
            factors: { profile_fit: detail, risk_fit: detail, fundamentals: detail, diversification: detail }, topDrivers: ['profile_fit', 'risk_fit'], reason: null, signals: set,
        };
    };
    const etfEntry = (index: string, holdings?: number) => ({ assetClass: 'etf' as const, sector: undefined, subIndustry: undefined, etf: { index, holdings, issuerUrl: 'https://issuer.example/fund' } });
    const textFr = (id: string) => (RULES.reasons.allowed_templates.find((template) => template.id === id) as { text_fr: string }).text_fr;

    it('every template has a French text with the same placeholders', () => {
        for (const template of RULES.reasons.allowed_templates as Array<{ id: string; text: string; text_fr: string }>) {
            const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();
            expect(placeholders(template.text_fr), template.id).toEqual(placeholders(template.text));
            expect(containsNeverWord(template.text_fr.replace(/\{\w+\}/g, '')), template.id).toBe(false);
        }
    });

    it('fills each one with the wording of text_fr', () => {
        const everything = profile('Expert', 'Medium', { sectors: [IT], brands: ['AAA'] });
        const holding: HoldingsSummary = { totalValueCad: 10000, bySector: { [IT]: 2000 }, byAssetClass: { stock: 2000 }, symbols: ['ADBE'] };
        const only = (id: string, target: WatchlistPick) => {
            const rules = structuredClone(RULES);
            rules.reasons.allowed_templates = rules.reasons.allowed_templates.filter((template) => template.id === id);
            return buildReason(target, everything, holding, { sectorOf: { ADBE: IT }, rules, locale: 'fr' })!.text;
        };
        const stock = pick(signals('AAA', {}, { change: 1.23 }));
        expect(only('same_sector_as_holding', stock)).toBe(textFr('same_sector_as_holding').replace('{ticker}', 'ADBE'));
        expect(only('picked_sector', stock)).toBe(textFr('picked_sector').replace('{sector}', 'Technologies de l’information'));
        expect(only('brands_list', stock)).toBe(textFr('brands_list'));
        expect(only('etf_tracks', pick(signals('SPX', etfEntry('S&P 500 Index'))))).toBe(textFr('etf_tracks').split(' / ')[0].replace('{index}', 'S&P 500'));
        expect(only('etf_tracks', pick(signals('ALL', etfEntry('', 9500))))).toBe(`FNB ${textFr('etf_tracks').split(' / ')[1].replace('{n}', `9${NBSP}500`)}`);
        expect(only('moved', stock)).toBe(textFr('moved').split(' / ')[0].replace('{x}', '+1,2'));
        expect(only('moved', pick(signals('AAA', {}, { closes: [100, 110] })))).toBe(textFr('moved').replace(' aujourd’hui / ', ' ').replace('{x}', '+10,0').replace('{window}', '1 mois'));
    });

    it('chooses the same template whatever the language, and renders one into the other', () => {
        const who = profile('Expert', 'Medium', { sectors: [IT] });
        for (const target of [pick(signals('AAA', {}, { change: 2.25 })), pick(signals('SPX', etfEntry('S&P 500 Index'))), pick(signals('BBB', { sector: 'Energy' }, { closes: [100, 90] }))]) {
            const en = buildReason(target, who, EMPTY_HOLDINGS, { locale: 'en' });
            const fr = buildReason(target, who, EMPTY_HOLDINGS, { locale: 'fr' });
            expect(fr!.templateId).toBe(en!.templateId);
            expect(fr!.sources).toEqual(en!.sources);
            expect(renderReason(en, 'fr')).toEqual(fr);
            expect(renderReason(fr, 'en')).toEqual(en);
        }
    });

    it('guards proper nouns by whole word: "Bon Appétit Group" skips the sentence, "Bonterra" does not', () => {
        const who = profile('Expert', 'Medium');
        const bon = pick(signals('BAG', etfEntry('Bon Appétit Group'), { change: 0.5 }));
        expect(buildReason(bon, who, EMPTY_HOLDINGS, { locale: 'fr' })!.templateId).toBe('moved');
        expect(buildReason(bon, who, EMPTY_HOLDINGS, { locale: 'en' })!.templateId).toBe('moved');
        const bonterra = pick(signals('BNE', etfEntry('Bonterra Energy Index'), { change: 0.5 }));
        expect(buildReason(bonterra, who, EMPTY_HOLDINGS, { locale: 'fr' })).toMatchObject({ templateId: 'etf_tracks', text: 'FNB qui suit l’indice Bonterra Energy' });
        const sector = pick(signals('ZZZ', { sector: 'Bon Appétit Group' }, { change: 0.5 }));
        expect(buildReason(sector, profile('Expert', 'Medium', { sectors: ['Bon Appétit Group'] }), EMPTY_HOLDINGS, { locale: 'fr' })!.templateId).toBe('moved');
    });

    it('no French or English output trips the guard, over sector names, companies and hostile data', () => {
        const words = [...SECTORS, 'Bonterra', 'Bon Appétit Group', 'Sûreté Inc.', 'Ventes Plus', 'Obligations Canada', 'AAA', 'S&P 500 Index', 'Good', 'SAFE', 'Achat', 'Vente'];
        let sentences = 0;
        for (const sector of words) {
            for (const other of words) {
                const stock = pick(signals('AAA', { sector }, { change: 1.5 }));
                const fund = pick(signals('FUND', etfEntry(other, 10)));
                const held: HoldingsSummary = { totalValueCad: 1, bySector: { [sector]: 1 }, byAssetClass: { stock: 1 }, symbols: ['HLD'] };
                for (const target of [stock, fund]) {
                    for (const who of [profile('Expert', 'Medium', { sectors: [sector] }), profile('Expert', 'Medium')]) {
                        for (const holdings of [held, EMPTY_HOLDINGS]) {
                            for (const locale of ['en', 'fr'] as const) {
                                const reason = buildReason(target, who, holdings, { sectorOf: { HLD: sector }, locale });
                                if (reason) {
                                    sentences++;
                                    expect(containsNeverWord(reason.text), reason.text).toBe(false);
                                }
                            }
                        }
                    }
                }
            }
        }
        expect(sentences).toBeGreaterThan(500);
    });
});

describe('never-words: the French list', () => {
    it('reads the French list from the rules file', () => {
        expect((RULES.reasons as { never_words_fr: string[] }).never_words_fr).toContain('sécuritaire');
    });

    it.each((RULES.reasons as { never_words_fr: string[] }).never_words_fr)('flags "%s" as a whole word, any case', (word) => {
        expect(containsNeverWord(`Selon nous, ${word} ici.`)).toBe(true);
        expect(containsNeverWord(`${word.toUpperCase()}!`)).toBe(true);
    });

    it.each(['ventes', 'achats', 'bons', 'recommandés', 'recommandées', 'Il faut', 'l’achat', 'd\'achat', 'sûrs', 'SÛR', 'sûr'])('flags the form "%s"', (text) => {
        expect(containsNeverWord(text)).toBe(true);
    });

    it.each([
        'bonus', 'Bonterra', 'obligation', 'Bonjour', 'sûreté', 'sur 1 mois', 'surtout', 'Bombardier', 'aventure', 'inventé', 'conventionnel',
        'achatine', 'devriezz', 'Variation de +1,2 % aujourd’hui', 'Même secteur que ADBE, que vous détenez', 'acquisition simulée', 'réduction de position simulée',
    ])('does not flag "%s"', (text) => {
        expect(containsNeverWord(text)).toBe(false);
    });
});
