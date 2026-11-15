// Every sentence the watchlist pipeline writes, in English and French, and the small machinery that renders one.
//
// A producer never writes a sentence by hand: it names a catalog key and the values (a TextRef), and the sentence is
// rendered from that pair for a language. The pair is stored beside the sentence (FilterCheck.textRef,
// FactorDetail.textRef, ReasonSentence.textRef), so a logged run can be read again in the other language with the
// very same wording a run computed in that language would have (renderRun in lib/watchlist/render.ts).
//
// Values in params stay the stable English identifiers of the data ('Medium', 'Novice', 'etf', GICS sector names);
// the display name in each language is chosen here. Numbers are formatted with the language's own conventions
// through i18n/format.ts (French: decimal comma, a no-break space before % and the currency after the amount).

import { DEFAULT_LOCALE, isLocale, type Locale } from '@/i18n/config';
import { formatMoney, formatNumber, formatPercent } from '@/i18n/format';
import type { TextParam, TextRef } from '@/lib/domain/types';

export type { Locale };
export type { TextParam, TextRef };

// ---------------------------------------------------------------- formatting for one language

const NBSP = ' ';

/** The percent sign as Intl writes it after a number in this language ("%" in English, " %" in French). */
function percentSuffix(locale: Locale): string {
    return formatPercent(0, locale, { maximumFractionDigits: 0 }).replace(/^0/, '');
}

const SECTOR_FR: Record<string, string> = {
    'Communication Services': 'Services de communication',
    'Consumer Discretionary': 'Consommation discrétionnaire',
    'Consumer Staples': 'Biens de consommation de base',
    Energy: 'Énergie',
    Financials: 'Services financiers',
    'Health Care': 'Soins de santé',
    Industrials: 'Industrie',
    'Information Technology': 'Technologies de l’information',
    Materials: 'Matériaux',
    'Real Estate': 'Immobilier',
    Utilities: 'Services publics',
};

/** The 11 GICS sector names of the universe, in French. A name not in this list is shown as the source wrote it. */
export const SECTOR_NAMES_FR: Readonly<Record<string, string>> = SECTOR_FR;

const LEVEL_FR: Record<string, string> = { Novice: 'Novice', Intermediate: 'Intermédiaire', Expert: 'Expert' };
const RISK_FR: Record<string, string> = { Low: 'Faible', Medium: 'Moyen', High: 'Élevé' };
// English keeps the identifiers the sentences always used ('etf', 'stock'); French gets display names
const ASSET_CLASS_FR: Record<string, string> = { stock: 'action', etf: 'FNB', crypto: 'cryptomonnaie', gold: 'or', bond_yield: 'rendement obligataire' };
const THEME_FR: Record<string, string> = { ai: 'IA', 'clean energy': 'énergie propre', dividends: 'dividendes', esg: 'ESG' };
const ESG_TAG_FR: Record<string, string> = { screened: 'évalué', 'not screened': 'non évalué', controversy: 'controverse' };

const lookup = (table: Record<string, string>, key: string): string =>
    Object.prototype.hasOwnProperty.call(table, key) ? table[key] : key;

/** The display names and number formats of one language, handed to every catalog sentence. */
export type Fmt = {
    locale: Locale;
    /** A plain number with a fixed number of decimals (or up to `max` decimals when decimals is undefined). */
    num(value: number, decimals?: number, max?: number): string;
    /** A fraction as a percentage: 0.35 -> "35.0%" / "35,0 %". */
    pct(fraction: number, decimals?: number): string;
    /** A value already in percent: 12.5 -> "12.5%" / "12,5 %". */
    pctOf(value: number, decimals?: number): string;
    /** Two fractions written with enough decimals that two different numbers never read the same. */
    pctPair(value: number, limit: number): [string, string];
    /** A number with its sign, where a value that rounds to zero has none: "+1.2", "-0.8", "0.0". */
    signed(value: number, decimals?: number): string;
    /** US dollars in billions or millions with 1 decimal; exact = true gives whole dollars. */
    usd(value: number, exact?: boolean): string;
    usdPair(value: number, limit: number): [string, string];
    /** A CAD amount with 2 decimals: "1,500.00 CAD" / "1 500,00 $". */
    cad(value: number): string;
    sector(name: string): string;
    level(name: string): string;
    risk(name: string): string;
    assetClass(id: string): string;
    theme(name: string): string;
    esgTag(tag: string): string;
    /** Quoted text: "x" / « x ». */
    q(text: string): string;
};

export function fmt(locale: Locale): Fmt {
    const fr = locale === 'fr';
    const suffix = percentSuffix(locale);
    const num = (value: number, decimals?: number, max?: number) =>
        formatNumber(value, locale, decimals === undefined ? { maximumFractionDigits: max ?? 6 } : { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    const pctOf = (value: number, decimals = 1) => num(value, decimals) + suffix;
    const pct = (fraction: number, decimals = 1) => pctOf(fraction * 100, decimals);
    const usd = (value: number, exact = false) => {
        if (!exact && Math.abs(value) >= 1e9) return fr ? `${num(value / 1e9, 1)}${NBSP}G$${NBSP}US` : `US$${num(value / 1e9, 1)}B`;
        if (!exact && Math.abs(value) >= 1e6) return fr ? `${num(value / 1e6, 1)}${NBSP}M$${NBSP}US` : `US$${num(value / 1e6, 1)}M`;
        return formatMoney(Math.round(value), 'USD', locale, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    };
    return {
        locale,
        num,
        pct,
        pctOf,
        // A sentence must never read "35.0% is above the 35.0% cap": when two different numbers round to the same
        // text, the pair is written with more precision.
        pctPair(value, limit) {
            for (let decimals = 1; decimals < 6; decimals++) {
                const pair: [string, string] = [pct(value, decimals), pct(limit, decimals)];
                if (pair[0] !== pair[1] || value === limit) return pair;
            }
            return [pct(value, 6), pct(limit, 6)];
        },
        signed: (value, decimals = 1) => formatNumber(value, locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals, signDisplay: 'exceptZero' }),
        usd,
        usdPair(value, limit) {
            const pair: [string, string] = [usd(value), usd(limit)];
            return pair[0] !== pair[1] || value === limit ? pair : [usd(value, true), usd(limit, true)];
        },
        cad: (value) => (fr ? formatMoney(value, 'CAD', locale) : `${num(value, 2)} CAD`),
        sector: (name) => (fr ? lookup(SECTOR_FR, name) : name),
        level: (name) => (fr ? lookup(LEVEL_FR, name) : name),
        risk: (name) => (fr ? lookup(RISK_FR, name) : name),
        assetClass: (id) => (fr ? lookup(ASSET_CLASS_FR, id) : id),
        theme: (name) => (fr ? lookup(THEME_FR, name.trim().toLowerCase()) : name),
        esgTag: (tag) => (fr ? lookup(ESG_TAG_FR, tag) : tag),
        q: (text) => (fr ? `«${NBSP}${text}${NBSP}»` : `"${text}"`),
    };
}

/** French typography: a no-break space before ":" and "%" and inside « ». Applied to every French sentence. */
function frenchTypography(text: string): string {
    return text.replace(/ ([:%»])/g, `${NBSP}$1`).replace(/« /g, `«${NBSP}`);
}

// ---------------------------------------------------------------- the registry

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sentence<P = any> = (params: P, f: Fmt) => string;
export type CatalogEntry<P = Record<string, TextParam>> = { en: Sentence<P>; fr: Sentence<P> };
export type ParamsOf<E> = E extends CatalogEntry<infer P> ? P : never;

const REGISTRY = new Map<string, CatalogEntry>();

/** Registers a catalog: its keys become renderable by renderText. A key registered twice keeps the last one. */
export function defineCatalog<C extends Record<string, CatalogEntry<never>>>(catalog: C): C {
    for (const [key, entry] of Object.entries(catalog)) REGISTRY.set(key, entry as unknown as CatalogEntry);
    return catalog;
}

/** True when a key can be rendered. */
export const hasText = (key: string): boolean => REGISTRY.has(key);

/** Any value as one of the two languages; anything else is English. */
export const toLocale = (value: unknown): Locale => (isLocale(value) ? value : DEFAULT_LOCALE);

/** The sentence of a TextRef in a language. Throws on a key no catalog holds. */
export function renderText(ref: TextRef, locale: Locale = DEFAULT_LOCALE): string {
    const entry = REGISTRY.get(ref.key);
    if (!entry) throw new Error(`text: no sentence has the key "${ref.key}"`);
    const lang = toLocale(locale);
    const text = entry[lang](ref.params ?? {}, fmt(lang));
    return lang === 'fr' ? frenchTypography(text) : text;
}

/**
 * renderText, or the fallback when the ref is missing, its key is unknown (a run logged before this catalog) or its
 * stored values cannot fill the sentence: a logged row is then shown as it was written, never dropped.
 */
export function renderOr(ref: TextRef | undefined, locale: Locale, fallback: string): string {
    if (!ref || !REGISTRY.has(ref.key)) return fallback;
    try {
        return renderText(ref, locale);
    } catch {
        return fallback;
    }
}

/** A param that is itself a sentence (a nested TextRef) or plain text, rendered in the language. */
export function sub(value: TextParam | undefined, locale: Locale): string {
    if (value && typeof value === 'object' && !Array.isArray(value) && 'key' in value) return renderText(value, locale);
    return value === undefined || value === null ? '' : String(value);
}

/** A list param of sentences, rendered and joined. */
export function subList(value: TextParam | undefined, locale: Locale, separator = '; '): string {
    if (!Array.isArray(value)) return sub(value, locale);
    return (value as Array<TextRef | string>).map((item) => (typeof item === 'string' ? item : renderText(item, locale))).join(separator);
}

/** A typed sentence maker for one catalog: say('key', params, locale) gives the text and the ref to store. */
export function sayer<C extends Record<string, CatalogEntry<never>>>(catalog: C) {
    void catalog; // only its type is used: the sentences were registered by defineCatalog
    return function say<K extends keyof C & string>(key: K, params: ParamsOf<C[K]>, locale: Locale = DEFAULT_LOCALE): { text: string; textRef: TextRef } {
        const textRef: TextRef = { key, params: params as unknown as Record<string, TextParam> };
        return { text: renderText(textRef, locale), textRef };
    };
}

// ---------------------------------------------------------------- the watchlist catalog

type Verdict = 'at' | 'above' | 'below' | 'within';
/** Floors (market cap, liquidity, Novice stocks) pass at or above; caps (volatility) pass at or within. */
const floorVerdict = (value: number, limit: number, pass: boolean): Verdict => (pass ? (value === limit ? 'at' : 'above') : 'below');
const capVerdict = (value: number, limit: number, pass: boolean): Verdict => (pass ? (value === limit ? 'at' : 'within') : 'above');

const EN_VERDICT: Record<Verdict, string> = { at: 'is at', above: 'is above', below: 'is below', within: 'is within' };
// Masculine forms: "le plafond", "le seuil", "le minimum"
const FR_VERDICT: Record<Verdict, string> = { at: 'égale au', above: 'au-dessus du', below: 'sous le', within: 'sous le' };

type Missing = 'market_cap' | 'avg_traded_value' | 'volatility_1y';
type NeededFor = 'market_cap_floor' | 'liquidity_minimum' | 'volatility_cap';
const MISSING_EN: Record<Missing, string> = { market_cap: 'market cap', avg_traded_value: 'average daily traded value', volatility_1y: '1-year volatility' };
const MISSING_FR: Record<Missing, string> = { market_cap: 'capitalisation boursière', avg_traded_value: 'valeur moyenne négociée par jour', volatility_1y: 'volatilité sur 1 an' };
const NEEDED_EN: Record<NeededFor, string> = { market_cap_floor: 'market-cap floor', liquidity_minimum: 'liquidity minimum', volatility_cap: 'volatility cap' };
const NEEDED_FR: Record<NeededFor, string> = { market_cap_floor: 'le seuil de capitalisation boursière', liquidity_minimum: 'le minimum de liquidité', volatility_cap: 'le plafond de volatilité' };

const MARKET_IN_FR: Record<string, string> = { US: 'aux États-Unis', Canada: 'au Canada' };
const pickedEn = (picked: string) => (picked === 'global' ? 'global (US and Canada)' : picked);
const pickedFr = (picked: string) => (picked === 'global' ? 'mondial (États-Unis et Canada)' : picked === 'US' ? 'États-Unis' : picked);

/** French shows an index by its name without a trailing "Index", after "l’indice": "l’indice S&P 500". */
const indexFr = (index: string) => `l’indice ${index.replace(/\s+Index$/i, '')}`;

type ValueLimit = { value: number; limit: number; pass: boolean };
type ProfileFit = {
    sector: string | null; sectorPicked: boolean; sectorPoints: number;
    niche: string | null; nichePicked: boolean; nichePoints: number;
    theme: string | null; themePoints: number;
    onBrands: boolean; brandsPoints: number;
    score: number;
};
type RiskFit = { state: 'missing' | 'negative' | 'above' | 'inside' | 'below'; volatility: number | null; lower: number; upper: number; risk: string; score: number };
type Fundamentals = {
    pe: number | null; peState: 'missing' | 'not_positive' | 'no_median' | 'scored';
    ratio: number | null; median: number | null; count: number | null; sector: string | null; pePart: number | null;
    growth: number | null; growthPart: number | null;
    parts: number; score: number;
};
type Diversification = { group: 'sector' | 'asset_class'; name: string; state: 'not_held' | 'total_unknown' | 'under' | 'not_under'; share: number | null; threshold: number; score: number };

function profileFitFacts(p: ProfileFit, f: Fmt): string[] {
    const plus = (points: number) => `(+${f.num(points, undefined, 1)})`;
    if (f.locale === 'fr') {
        return [
            p.sectorPicked ? `secteur ${f.sector(p.sector ?? '')} choisi ${plus(p.sectorPoints)}` : p.sector ? `secteur ${f.sector(p.sector)} non choisi` : 'aucun secteur',
            // A sub-industry is the source's own label (GICS, in English): it is quoted as given
            p.nichePicked ? `créneau ${f.q(p.niche ?? '')} choisi ${plus(p.nichePoints)}` : 'créneau non choisi',
            p.theme !== null ? `thème ${f.theme(p.theme)} choisi ${plus(p.themePoints)}` : 'aucun thème choisi',
            p.onBrands ? `dans la liste de marques ${plus(p.brandsPoints)}` : 'absent de la liste de marques',
        ];
    }
    return [
        p.sectorPicked ? `sector ${p.sector} was picked ${plus(p.sectorPoints)}` : p.sector ? `sector ${p.sector} was not picked` : 'no sector',
        p.nichePicked ? `niche ${p.niche} was picked ${plus(p.nichePoints)}` : 'niche not picked',
        p.theme !== null ? `theme ${p.theme} was picked ${plus(p.themePoints)}` : 'no picked theme',
        p.onBrands ? `on the brands list ${plus(p.brandsPoints)}` : 'not on the brands list',
    ];
}

function fundamentalsFacts(p: Fundamentals, f: Fmt): string[] {
    const fr = f.locale === 'fr';
    const facts: string[] = [];
    const pe = p.pe === null ? '' : f.num(p.pe, 1);
    if (p.peState === 'missing') facts.push(fr ? 'C/B : aucune donnée' : 'P/E: no data');
    else if (p.peState === 'not_positive') facts.push(fr ? `C/B de ${pe} négatif ou nul : non noté` : `P/E ${pe} is negative or zero: not scored`);
    else if (p.peState === 'no_median') facts.push(fr ? `C/B de ${pe} : aucune médiane sectorielle de comparaison, non noté` : `P/E ${pe}: no sector median to compare with, not scored`);
    else {
        const ratio = f.num(p.ratio ?? 0, 2);
        const median = f.num(p.median ?? 0, 1);
        const part = f.num(p.pePart ?? 0, 1);
        facts.push(fr
            ? `C/B de ${pe}, soit ${ratio} fois la médiane de ${median} des ${f.num(p.count ?? 0)} candidat(s) du secteur ${f.sector(p.sector ?? '')} ayant un C/B dans cet instantané : ${part}`
            : `P/E ${pe} is ${ratio}x the median ${median} of the ${f.num(p.count ?? 0)} ${p.sector} candidate(s) with a P/E in this snapshot: ${part}`);
    }
    if (p.growth === null) facts.push(fr ? 'croissance des revenus : aucune donnée' : 'revenue growth: no data');
    else {
        const part = f.num(p.growthPart ?? 0, 1);
        facts.push(fr ? `croissance des revenus de ${f.pctOf(p.growth, 1)} sur un an : ${part}` : `revenue growth ${f.pctOf(p.growth, 1)} year over year: ${part}`);
    }
    return facts;
}

function riskBand(p: RiskFit, f: Fmt): string {
    return f.locale === 'fr'
        ? `fourchette de ${f.pct(p.lower)} à ${f.pct(p.upper)} pour un profil de risque ${f.risk(p.risk)}`
        : `${f.pct(p.lower)} to ${f.pct(p.upper)} band for ${p.risk} risk`;
}

export const WATCHLIST_TEXT = defineCatalog({
    // ---- filters: missing or unusable data (filter 'data')
    'filter.data.missing': {
        en: (p: { what: Missing; neededFor: NeededFor }) => `${MISSING_EN[p.what]} is missing, so the ${NEEDED_EN[p.neededFor]} cannot be checked`,
        fr: (p: { what: Missing; neededFor: NeededFor }) => `${MISSING_FR[p.what]} manquante : impossible de vérifier ${NEEDED_FR[p.neededFor]}`,
    },
    'filter.data.fx_missing': {
        en: (p: { what: Missing; neededFor: NeededFor }) => `USD/CAD rate is missing, so the ${MISSING_EN[p.what]} in CAD cannot be converted for the ${NEEDED_EN[p.neededFor]}`,
        fr: (p: { what: Missing; neededFor: NeededFor }) => `taux USD/CAD manquant : la ${MISSING_FR[p.what]} en dollars canadiens ne peut pas être convertie pour vérifier ${NEEDED_FR[p.neededFor]}`,
    },
    'filter.data.volatility_negative': {
        en: (p: { value: number }, f) => `1-year volatility ${f.pct(p.value)} is negative, which is not a valid value, so the volatility cap cannot be checked`,
        fr: (p: { value: number }, f) => `volatilité sur 1 an de ${f.pct(p.value)} : une valeur négative n’est pas valide, donc le plafond de volatilité ne peut pas être vérifié`,
    },
    'filter.data.no_signals': {
        en: (p: { symbol: string }) => `no signals were collected for ${p.symbol} in this snapshot`,
        fr: (p: { symbol: string }) => `aucun signal n’a été recueilli pour ${p.symbol} dans cet instantané`,
    },

    // ---- filters
    'filter.avoid.symbol': {
        en: (p: { symbol: string }) => `${p.symbol} is on the avoid list`,
        fr: (p: { symbol: string }) => `${p.symbol} figure dans la liste d’exclusion`,
    },
    'filter.avoid.sector': {
        en: (p: { symbol: string; sector: string }) => `${p.symbol} is in ${p.sector}, a sector on the avoid list`,
        fr: (p: { symbol: string; sector: string }, f) => `${p.symbol} fait partie du secteur ${f.sector(p.sector)}, qui figure dans la liste d’exclusion`,
    },
    'filter.avoid.clear': {
        en: (p: { symbol: string; sector: string | null }) => `${p.sector !== null ? `${p.symbol} and its sector ${p.sector} are` : `${p.symbol} is`} not on the avoid list`,
        fr: (p: { symbol: string; sector: string | null }, f) => (p.sector !== null
            ? `${p.symbol} et son secteur (${f.sector(p.sector)}) ne figurent pas dans la liste d’exclusion`
            : `${p.symbol} ne figure pas dans la liste d’exclusion`),
    },
    'filter.markets.none': {
        en: (p: { symbol: string; picked: string }) => `${p.symbol} has no listing market on file; markets picked: ${pickedEn(p.picked)}`,
        fr: (p: { symbol: string; picked: string }) => `aucun marché d’inscription n’est connu pour ${p.symbol}; marchés choisis : ${pickedFr(p.picked)}`,
    },
    'filter.markets.listed': {
        en: (p: { symbol: string; market: string; picked: string }) => `${p.symbol} is listed in ${p.market}; markets picked: ${pickedEn(p.picked)}`,
        fr: (p: { symbol: string; market: string; picked: string }) => `${p.symbol} est inscrit en bourse ${lookup(MARKET_IN_FR, p.market)}; marchés choisis : ${pickedFr(p.picked)}`,
    },
    'filter.volatility': {
        en: (p: ValueLimit & { risk: string }, f) => {
            const [value, limit] = f.pctPair(p.value, p.limit);
            return `volatility ${value} ${EN_VERDICT[capVerdict(p.value, p.limit, p.pass)]} the ${limit} cap for ${p.risk} risk`;
        },
        fr: (p: ValueLimit & { risk: string }, f) => {
            const [value, limit] = f.pctPair(p.value, p.limit);
            return `volatilité de ${value}, ${FR_VERDICT[capVerdict(p.value, p.limit, p.pass)]} plafond de ${limit} pour un profil de risque ${f.risk(p.risk)}`;
        },
    },
    'filter.market_cap_floor': {
        en: (p: ValueLimit & { risk: string }, f) => {
            const [value, limit] = f.usdPair(p.value, p.limit);
            return `market cap ${value} ${EN_VERDICT[floorVerdict(p.value, p.limit, p.pass)]} the ${limit} floor for ${p.risk} risk`;
        },
        fr: (p: ValueLimit & { risk: string }, f) => {
            const [value, limit] = f.usdPair(p.value, p.limit);
            return `capitalisation boursière de ${value}, ${FR_VERDICT[floorVerdict(p.value, p.limit, p.pass)]} seuil de ${limit} pour un profil de risque ${f.risk(p.risk)}`;
        },
    },
    'filter.liquidity': {
        en: (p: ValueLimit, f) => {
            const [value, limit] = f.usdPair(p.value, p.limit);
            return `average traded value ${value} a day ${EN_VERDICT[floorVerdict(p.value, p.limit, p.pass)]} the ${limit} a day minimum`;
        },
        fr: (p: ValueLimit, f) => {
            const [value, limit] = f.usdPair(p.value, p.limit);
            return `valeur moyenne négociée de ${value} par jour, ${FR_VERDICT[floorVerdict(p.value, p.limit, p.pass)]} minimum de ${limit} par jour`;
        },
    },
    'filter.esg.not_picked': {
        en: (p: { tag: string }) => `ESG theme not picked, so the ESG tag "${p.tag}" (demo data) is not checked`,
        fr: (p: { tag: string }, f) => `thème ESG non choisi : l’étiquette ESG ${f.q(f.esgTag(p.tag))} (données de démonstration) n’est pas vérifiée`,
    },
    'filter.esg.picked': {
        en: (p: { tag: string }) => `ESG theme picked: only "screened" passes; the ESG tag is "${p.tag}" (demo data)`,
        fr: (p: { tag: string }, f) => `thème ESG choisi : seule l’étiquette ${f.q(f.esgTag('screened'))} est admise; l’étiquette ESG est ${f.q(f.esgTag(p.tag))} (données de démonstration)`,
    },
    'filter.novice.stock': {
        en: (p: ValueLimit, f) => {
            const [value, limit] = f.usdPair(p.value, p.limit);
            return `market cap ${value} ${EN_VERDICT[floorVerdict(p.value, p.limit, p.pass)]} the ${limit} floor for Novice stocks`;
        },
        fr: (p: ValueLimit, f) => {
            const [value, limit] = f.usdPair(p.value, p.limit);
            return `capitalisation boursière de ${value}, ${FR_VERDICT[floorVerdict(p.value, p.limit, p.pass)]} seuil de ${limit} pour les actions au niveau Novice`;
        },
    },
    'filter.blue_chip_etf': {
        en: (p: { symbol: string; onList: boolean; who: 'novice' | 'low_risk' }) =>
            `${p.symbol} is ${p.onList ? '' : 'not '}on the blue-chip ETF list; ${p.who === 'novice' ? 'a Novice' : 'a Low risk profile'} only gets blue-chip ETFs`,
        fr: (p: { symbol: string; onList: boolean; who: 'novice' | 'low_risk' }, f) =>
            `${p.symbol} ${p.onList ? 'figure' : 'ne figure pas'} dans la liste des FNB de premier ordre; ${p.who === 'novice' ? `au niveau ${f.level('Novice')}` : `avec un profil de risque ${f.risk('Low')}`}, seuls les FNB de premier ordre sont retenus`,
    },
    'filter.crypto.not_listed': {
        en: (p: { symbol: string; assets: string[] }) => `${p.symbol} is not one of the crypto assets listed (${p.assets.join(', ')})`,
        fr: (p: { symbol: string; assets: string[] }) => `${p.symbol} ne fait pas partie des cryptomonnaies retenues (${p.assets.join(', ')})`,
    },
    'filter.crypto.risk': {
        en: (p: { allowed: string[]; risk: string }) => `crypto is listed for ${p.allowed.join(' / ')} risk only; the profile's risk is ${p.risk}`,
        fr: (p: { allowed: string[]; risk: string }, f) => `les cryptomonnaies ne sont retenues que pour un profil de risque ${p.allowed.map(f.risk).join(' / ')}; le profil de risque est ${f.risk(p.risk)}`,
    },
    'filter.crypto.novice': {
        en: () => 'crypto is never listed for a Novice',
        fr: (_p: Record<string, never>, f: Fmt) => `les cryptomonnaies ne sont jamais retenues au niveau ${f.level('Novice')}`,
    },

    // ---- score factors
    'factor.profile_fit': {
        en: (p: ProfileFit, f) => `${profileFitFacts(p, f).join('; ')}: ${f.num(p.score, undefined, 1)} of 100`,
        fr: (p: ProfileFit, f) => `${profileFitFacts(p, f).join('; ')} : ${f.num(p.score, undefined, 1)} sur 100`,
    },
    'factor.risk_fit': {
        en: (p: RiskFit, f) => {
            const v = p.volatility === null ? '' : f.pct(p.volatility);
            if (p.state === 'missing') return '1-year volatility is missing: no risk fit can be computed';
            if (p.state === 'negative') return `1-year volatility ${v} is negative, which is not a valid value: no risk fit can be computed`;
            if (p.state === 'above') return `volatility ${v} is above the ${riskBand(p, f)}: 0`;
            if (p.state === 'inside') return `volatility ${v} is inside the ${riskBand(p, f)}: 100`;
            return `volatility ${v} is below the ${riskBand(p, f)}: 100 - 50 x (${f.pct(p.lower)} - ${v}) / ${f.pct(p.lower)} = ${f.num(p.score, 1)}`;
        },
        fr: (p: RiskFit, f) => {
            const v = p.volatility === null ? '' : f.pct(p.volatility);
            if (p.state === 'missing') return 'volatilité sur 1 an manquante : aucune correspondance au profil de risque ne peut être calculée';
            if (p.state === 'negative') return `volatilité sur 1 an de ${v} : une valeur négative n’est pas valide, aucune correspondance au profil de risque ne peut être calculée`;
            if (p.state === 'above') return `volatilité de ${v}, au-dessus de la ${riskBand(p, f)} : 0`;
            if (p.state === 'inside') return `volatilité de ${v}, dans la ${riskBand(p, f)} : 100`;
            return `volatilité de ${v}, sous la ${riskBand(p, f)} : 100 - 50 × (${f.pct(p.lower)} - ${v}) / ${f.pct(p.lower)} = ${f.num(p.score, 1)}`;
        },
    },
    'factor.fundamentals': {
        en: (p: Fundamentals, f) => {
            const facts = fundamentalsFacts(p, f).join('; ');
            if (p.parts === 0) return `${facts}: no data, set to 50`;
            return `${facts}; ${p.parts === 2 ? 'mean of the two' : 'the only part with data'}: ${f.num(p.score, 1)}`;
        },
        fr: (p: Fundamentals, f) => {
            const facts = fundamentalsFacts(p, f).join('; ');
            if (p.parts === 0) return `${facts} : aucune donnée, valeur fixée à 50`;
            return `${facts}; ${p.parts === 2 ? 'moyenne des deux' : 'seule composante avec des données'} : ${f.num(p.score, 1)}`;
        },
    },
    'factor.diversification': {
        en: (p: Diversification, f) => {
            const group = p.group === 'sector' ? `sector ${p.name}` : `asset class ${p.name} (no sector)`;
            const threshold = f.pct(p.threshold, 0);
            const share = p.share === null ? '' : f.pctPair(p.share, p.threshold)[0];
            if (p.state === 'not_held') return `its ${group} is not in the simulated holdings: 100`;
            if (p.state === 'total_unknown') return `its ${group} is held but the portfolio value is not known, so its share cannot be shown to be under ${threshold}: 0`;
            if (p.state === 'under') return `its ${group} is held and is ${share} of the portfolio value, under ${threshold}: 50`;
            return `its ${group} is held and is ${share} of the portfolio value, not under ${threshold}: 0`;
        },
        fr: (p: Diversification, f) => {
            const group = p.group === 'sector' ? `le secteur ${f.sector(p.name)}` : `la classe d’actifs ${f.assetClass(p.name)} (sans secteur)`;
            const threshold = f.pct(p.threshold, 0);
            const share = p.share === null ? '' : f.pctPair(p.share, p.threshold)[0];
            if (p.state === 'not_held') return `le portefeuille simulé ne contient pas ${group} : 100`;
            if (p.state === 'total_unknown') return `le portefeuille simulé contient ${group}, mais sa valeur totale est inconnue, donc la part de ce groupe ne peut pas être établie sous ${threshold} : 0`;
            if (p.state === 'under') return `le portefeuille simulé contient ${group}, qui représente ${share} de sa valeur, sous ${threshold} : 50`;
            return `le portefeuille simulé contient ${group}, qui représente ${share} de sa valeur, soit au moins ${threshold} : 0`;
        },
    },

    // ---- reason sentences: the allowed templates of rules.reasons (text / text_fr), in the same order
    'reason.same_sector_as_holding': {
        en: (p: { ticker: string }) => `Same sector as ${p.ticker}, which you hold`,
        fr: (p: { ticker: string }) => `Même secteur que ${p.ticker}, que vous détenez`,
    },
    'reason.picked_sector': {
        en: (p: { sector: string }) => `In ${p.sector}, a sector you picked`,
        fr: (p: { sector: string }, f) => `Dans le secteur ${f.sector(p.sector)}, que vous avez choisi`,
    },
    'reason.brands_list': {
        en: () => 'On your brands list',
        fr: () => 'Figure dans votre liste de marques',
    },
    'reason.etf_tracks': {
        en: (p: { index: string | null; holdings: number | null }, f) => (p.index !== null ? `ETF that tracks ${p.index}` : `ETF that holds ${formatNumber(p.holdings ?? 0, f.locale, { maximumFractionDigits: 0, useGrouping: false })} companies`),
        fr: (p: { index: string | null; holdings: number | null }, f) => (p.index !== null ? `FNB qui suit ${indexFr(p.index)}` : `FNB qui détient ${f.num(p.holdings ?? 0, undefined, 0)} sociétés`),
    },
    'reason.moved': {
        en: (p: { change: number; window: 'today' | '1m' }, f) => `Moved ${f.signed(p.change)}% ${p.window === 'today' ? 'today' : 'over 1 month'}`,
        fr: (p: { change: number; window: 'today' | '1m' }, f) => `Variation de ${f.signed(p.change)} % ${p.window === 'today' ? 'aujourd’hui' : 'sur 1 mois'}`,
    },
});

export type WatchlistTextKey = keyof typeof WATCHLIST_TEXT;
export type WatchlistParams<K extends WatchlistTextKey> = ParamsOf<(typeof WATCHLIST_TEXT)[K]>;

/** The watchlist sentence maker: say('filter.volatility', { value, limit, pass, risk }, 'fr'). */
export const say = sayer(WATCHLIST_TEXT);
