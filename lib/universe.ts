import universeFile from '@/data/universe.json';
import themesFile from '@/data/themes.json';
import esgFile from '@/data/esg-demo.json';
import type { UniverseEntry } from '@/lib/domain/types';

// The candidate universe: which names can be considered at all, before any market data.
// Built by scripts/build-universe.mjs; nothing here is fetched at run time.

export type UniverseSource = {
    id: string;
    name: string;
    url: string;
    revision?: string | number;
    date: string;
    licence: string;
    attribution?: string;
    usedFor: string;
};

const ENTRIES = universeFile.entries as UniverseEntry[];
const BY_SYMBOL = new Map(ENTRIES.map((entry) => [entry.symbol, entry]));

/** When the file was built, when US names were ranked by market cap, and every list source with its licence. */
export const UNIVERSE_INFO = {
    generated: universeFile.generated as string,
    usRankDate: universeFile.usRank.rankDate as string,
    sources: universeFile.sources as UniverseSource[],
};

/** Shown wherever an ESG tag appears: the tags are a mock. */
export const ESG_NOTE: string = esgFile.note;

/** Shown wherever a theme tag appears: membership is hand-set. */
export const THEMES_NOTE: string = themesFile.note;

export function getUniverse(): UniverseEntry[] {
    // A fresh array each time: a caller that sorts or filters in place must not reorder the shared list.
    return [...ENTRIES];
}

/** Accepts any letter case; class shares in either form ('BRK.B', 'brk-b', 'CTC-A.TO', 'ctc.a.to'). */
export function getEntry(symbol: string): UniverseEntry | undefined {
    const wanted = symbol.trim().toUpperCase();
    const direct = BY_SYMBOL.get(wanted);
    if (direct) return direct;
    const isToronto = wanted.endsWith('.TO');
    const base = isToronto ? wanted.slice(0, -3) : wanted;
    return BY_SYMBOL.get(isToronto ? `${base.replace(/\./g, '-')}.TO` : base.replace(/-/g, '.'));
}

const byName = (a: string, b: string) => a.localeCompare(b);

/** GICS sector names of the stocks in the universe, with how many stocks each holds. */
export function listSectors(): Array<{ sector: string; count: number }> {
    const counts = new Map<string, number>();
    for (const entry of ENTRIES) {
        if (entry.assetClass === 'stock' && entry.sector) counts.set(entry.sector, (counts.get(entry.sector) ?? 0) + 1);
    }
    return [...counts].map(([sector, count]) => ({ sector, count })).sort((a, b) => byName(a.sector, b.sector));
}

/** Sub-industries ("niches") of one sector, or of every sector. Canadian names have none, so they are not counted. */
export function listNiches(sector?: string): Array<{ niche: string; sector: string; count: number }> {
    const niches = new Map<string, { niche: string; sector: string; count: number }>();
    for (const entry of ENTRIES) {
        if (entry.assetClass !== 'stock' || !entry.sector || !entry.subIndustry) continue;
        if (sector && entry.sector !== sector) continue;
        const key = `${entry.sector}|${entry.subIndustry}`;
        const row = niches.get(key) ?? { niche: entry.subIndustry, sector: entry.sector, count: 0 };
        row.count++;
        niches.set(key, row);
    }
    return [...niches.values()].sort((a, b) => byName(a.sector, b.sector) || byName(a.niche, b.niche));
}

/** The hand-set themes with their members. 'ESG' is not listed: it is the mock tag on each entry. */
export function listThemes(): Array<{ theme: string; count: number; symbols: string[] }> {
    return themesFile.themes.map(({ id }) => {
        const symbols = ENTRIES.filter((entry) => entry.themes.includes(id)).map((entry) => entry.symbol);
        return { theme: id, count: symbols.length, symbols };
    });
}

/** Why a symbol carries a theme tag: the one-line basis written in data/themes.json. */
export function themeBasis(symbol: string, theme: string): string | undefined {
    const entry = getEntry(symbol);
    const rule = themesFile.themes.find(({ id }) => id === theme);
    if (!entry || !rule || !entry.themes.includes(theme)) return undefined;
    return rule.symbols.find((s) => s.symbol === entry.symbol)?.basis
        ?? rule.subIndustries.find((s) => s.name === entry.subIndustry)?.basis;
}

/** Filter families offered by the search palette. 'bond' and 'gold' also take the funds that hold them. */
export const UNIVERSE_KINDS = ['stock', 'etf', 'bond', 'crypto', 'gold'] as const;
export type UniverseKind = (typeof UNIVERSE_KINDS)[number];
export type UniverseFilter = { kind?: UniverseKind; market?: 'US' | 'Canada'; sector?: string };

const BOND_FUND = /\bbond|treasury/i;
const GOLD_FUND = /\bgold\b/i;
const fundText = (entry: UniverseEntry) => `${entry.name} ${entry.etf?.index ?? ''}`;

/** Which palette family an entry belongs to; a bond fund is also an ETF, a gold fund is also an ETF. */
export function matchesKind(entry: UniverseEntry, kind: UniverseKind): boolean {
    switch (kind) {
        case 'stock': return entry.assetClass === 'stock';
        case 'etf': return entry.assetClass === 'etf';
        case 'bond': return entry.assetClass === 'etf' && BOND_FUND.test(fundText(entry));
        case 'crypto': return entry.assetClass === 'crypto';
        case 'gold': return entry.assetClass === 'gold' || (entry.assetClass === 'etf' && GOLD_FUND.test(fundText(entry)));
    }
}

export const hasUniverseFilter = (filter: UniverseFilter) => !!(filter.kind || filter.market || filter.sector);

/**
 * Search with filters. With text, the order of searchUniverse; without text, every matching entry sorted by name.
 * A sector only matches stocks (funds carry no GICS sector).
 */
export function filterUniverse(q: string, filter: UniverseFilter, limit = 60): UniverseEntry[] {
    if (!(limit > 0)) return [];
    const keep = (entry: UniverseEntry) =>
        (!filter.kind || matchesKind(entry, filter.kind))
        && (!filter.market || entry.market === filter.market)
        && (!filter.sector || entry.sector === filter.sector);
    const pool = q.trim()
        ? searchUniverse(q, ENTRIES.length)
        : [...ENTRIES].sort((a, b) => byName(a.name, b.name));
    return pool.filter(keep).slice(0, limit);
}

/** Search by symbol or name. Exact symbol first, then symbols starting with the text, then names containing it. */
export function searchUniverse(q: string, limit = 10): UniverseEntry[] {
    const text = q.trim().toUpperCase();
    if (!text || !(limit > 0)) return [];
    // Class shares are written with a dot or a dash ('CTC.A', 'BRK-B'); compare symbols with one form.
    const dotted = text.replace(/-/g, '.');
    const rank = (entry: UniverseEntry) => {
        const symbol = entry.symbol.replace(/-/g, '.');
        if (symbol === dotted || symbol === `${dotted}.TO`) return 0;
        if (symbol.startsWith(dotted)) return 1;
        const name = entry.name.toUpperCase();
        if (name.startsWith(text)) return 2;
        return name.includes(text) ? 3 : -1;
    };
    return ENTRIES
        .map((entry) => ({ entry, rank: rank(entry) }))
        .filter((hit) => hit.rank >= 0)
        .sort((a, b) => a.rank - b.rank || byName(a.entry.symbol, b.entry.symbol))
        .slice(0, limit)
        .map((hit) => hit.entry);
}
