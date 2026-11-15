import type { UniverseEntry } from '@/lib/domain/types';
import { normalize, type ProfileView } from '@/lib/watchlist/format';

/**
 * Stage A. Candidates are:
 *  - seed tickers: every universe entry named on the brands list, whatever its market
 *    (a seed outside the picked markets is then rejected by the market filter, with the reason shown);
 *  - stocks and ETFs in the picked markets whose sector, sub-industry or one theme was picked;
 *    with no sector, niche or theme picked at all ("no preference"), every stock and ETF in those markets;
 *  - every crypto, gold and bond-yield entry (the filters decide who may see them).
 * The result is sorted by symbol so the input order of the universe never matters.
 */
export function selectCandidates(universe: UniverseEntry[], profile: ProfileView): { candidates: UniverseEntry[]; seeds: string[] } {
    const { answers } = profile;
    const brands = new Set(answers.brands.map(normalize));
    const sectors = new Set(answers.sectors.map(normalize));
    const niches = new Set(answers.niches.map(normalize));
    const themes = new Set(answers.themes.map(normalize));
    const noPreference = sectors.size === 0 && niches.size === 0 && themes.size === 0;

    const bySymbol = new Map<string, UniverseEntry>();
    const seeds: string[] = [];
    for (const entry of universe) {
        if (bySymbol.has(entry.symbol)) continue;
        const isSeed = brands.has(normalize(entry.symbol));
        const listed = entry.assetClass === 'stock' || entry.assetClass === 'etf';
        const inMarket = answers.markets === 'global' ? entry.market !== 'none' : entry.market === answers.markets;
        const interest = noPreference
            || (entry.sector !== undefined && sectors.has(normalize(entry.sector)))
            || (entry.subIndustry !== undefined && niches.has(normalize(entry.subIndustry)))
            || entry.themes.some((theme) => themes.has(normalize(theme)));

        if (isSeed || !listed || (inMarket && interest)) bySymbol.set(entry.symbol, entry);
        if (isSeed) seeds.push(entry.symbol);
    }

    const bySymbolOrder = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
    return {
        candidates: [...bySymbol.values()].sort((a, b) => bySymbolOrder(a.symbol, b.symbol)),
        seeds: seeds.sort(bySymbolOrder),
    };
}
