import type { Candidate, FactorScores, Pick as WatchlistPick } from '@/lib/domain/types';
import type { Rules } from '@/lib/rules';
import { normalize, numberOf, own, type ProfileView } from '@/lib/watchlist/format';
import { topDrivers, type Factors } from '@/lib/watchlist/score';

export type PreviousList = { listedSince: Record<string, string>; previousPicks: string[] };

type Scored = Candidate & { factors: Factors; total: number };

const DAY_MS = 86_400_000;
const bySymbol = (a: Scored, b: Scored) => (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0);
const volatilityOf = (c: Scored) => numberOf(c.signals.volatility1y) ?? Number.POSITIVE_INFINITY;
// Totals have 1 decimal; comparing them as whole tenths avoids floating-point surprises around the margin.
const tenths = (total: number) => Math.round(total * 10);

/** The tie-break of the rules file: higher total, then lower volatility, then ticker A-Z. */
export function compareRank(a: Scored, b: Scored): number {
    return tenths(b.total) - tenths(a.total) || volatilityOf(a) - volatilityOf(b) || bySymbol(a, b);
}

/**
 * Stage D. Input: the candidates that passed the filters and were scored (anything else is ignored).
 *
 * How the rules are applied, in order. Everything is a pure function of the inputs.
 *
 * 1. Who is "listed": the symbols in previous.previousPicks (the last run's list). A listed symbol that is not
 *    among today's passing candidates is dropped at once; that is the "fails a filter" exception.
 * 2. Slots are filled in three groups, until N (by level) is reached:
 *    a. Seeds (brands that passed the filters), in tie-break order. "Kept if they pass" is read as: a seed is
 *       not subject to the score cut-off, the sector cap or the newcomer margin.
 *    b. Listed symbols still inside their minimum stay (listed fewer than min_days_listed whole days before
 *       `now`), in tie-break order. They are not subject to the sector cap or the margin either: the only
 *       exception the rule names is failing a filter. A listed symbol with no known listing date is treated as
 *       listed today.
 *    c. Everyone else, ordered by total, where a listed symbol's total counts with the newcomer margin added.
 *       So a newcomer comes before a listed symbol only when its total is higher by MORE than the margin
 *       (exactly the margin is not enough), and a listed symbol loses its place only to such a newcomer, to a
 *       listed symbol with a higher total, or to groups a and b. Remaining ties: lower volatility, ticker A-Z.
 *       Group c obeys the sector cap, counting the picks of groups a and b already in that sector.
 * 3. Hard limits for every group: N picks in total and max_crypto crypto assets (a seed does not lift these).
 *    The sector cap applies to assets that have a sector; ETFs and crypto have none.
 * 4. The margin and the minimum stay decide who is ON the list. The rank shown is always the plain tie-break
 *    order of the picks, so the ranking stays explainable from the scores alone.
 * 5. listedSince for the next run: unchanged for a symbol that stays, `now` for one that enters.
 */
export function selectPicks(
    scored: Candidate[],
    profile: ProfileView,
    rules: Rules,
    previous: PreviousList,
    now: string,
): { picks: WatchlistPick[]; listedSince: Record<string, string> } {
    const rule = rules.selection;
    const limit = rule.top_n_by_level[profile.level];
    const marginTenths = Math.round(rule.slow_moving.newcomer_margin_points * 10);
    const pool = scored.filter((c): c is Scored => c.passed && c.factors !== undefined && c.total !== undefined);

    const brands = new Set(profile.answers.brands.map(normalize));
    const listed = new Set(previous.previousPicks);
    const isSeed = (c: Scored) => brands.has(normalize(c.symbol));
    const isListed = (c: Scored) => listed.has(c.symbol);
    const daysListed = (c: Scored) => {
        const since = Date.parse(own(previous.listedSince, c.symbol) ?? now);
        return Number.isNaN(since) ? 0 : Math.floor((Date.parse(now) - since) / DAY_MS);
    };
    const group = (c: Scored) => (isSeed(c) ? 0 : isListed(c) && daysListed(c) < rule.slow_moving.min_days_listed ? 1 : 2);
    const effective = (c: Scored) => tenths(c.total) + (isListed(c) ? marginTenths : 0);

    const order = [...pool].sort((a, b) => {
        const groups = group(a) - group(b);
        if (groups !== 0) return groups;
        if (group(a) < 2) return compareRank(a, b);
        return effective(b) - effective(a)
            || Number(isListed(b)) - Number(isListed(a))
            || volatilityOf(a) - volatilityOf(b)
            || bySymbol(a, b);
    });

    const chosen: Scored[] = [];
    const perSector = new Map<string, number>();
    let crypto = 0;
    for (const candidate of order) {
        if (chosen.length >= limit) break;
        const { assetClass, sector } = candidate.signals.entry;
        if (assetClass === 'crypto' && crypto >= rule.max_crypto) continue;
        if (group(candidate) === 2 && sector !== undefined && (perSector.get(sector) ?? 0) >= rule.max_per_sector) continue;
        chosen.push(candidate);
        if (assetClass === 'crypto') crypto++;
        if (sector !== undefined) perSector.set(sector, (perSector.get(sector) ?? 0) + 1);
    }

    const listedSince: Record<string, string> = {};
    const picks = chosen.sort(compareRank).map((candidate, index): WatchlistPick => {
        const { entry } = candidate.signals;
        listedSince[candidate.symbol] = isListed(candidate) ? own(previous.listedSince, candidate.symbol) ?? now : now;
        return {
            rank: index + 1,
            symbol: candidate.symbol,
            name: entry.name,
            assetClass: entry.assetClass,
            ...(entry.sector !== undefined ? { sector: entry.sector } : {}),
            total: candidate.total,
            factors: candidate.factors,
            topDrivers: topDrivers(candidate.factors, rules) as Array<keyof FactorScores>,
            reason: null, // filled by buildReason in the pipeline
            kept: isSeed(candidate) ? 'seed' : isListed(candidate) ? 'incumbent' : 'new',
            signals: candidate.signals,
        };
    });
    return { picks, listedSince };
}
