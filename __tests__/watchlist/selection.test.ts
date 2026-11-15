import { describe, expect, it } from 'vitest';
import type { Candidate, Level, UniverseEntry } from '@/lib/domain/types';
import { RULES } from '@/lib/rules';
import { selectPicks, type PreviousList } from '@/lib/watchlist/selection';
import { NOW, profile, shuffled, signals } from './fixtures';

const NONE: PreviousList = { listedSince: {}, previousPicks: [] };
const daysAgo = (days: number) => new Date(Date.parse(NOW) - days * 86_400_000).toISOString();

/** A candidate that passed the filters, with a given total. Each gets its own sector unless one is given. */
function scored(symbol: string, total: number, over: Partial<UniverseEntry> = {}, volatility = 0.25): Candidate {
    const detail = { score: total, detail: 'fixture' };
    return {
        symbol,
        signals: signals(symbol, { sector: `Sector ${symbol}`, ...over }, { volatility }),
        filters: [],
        passed: true,
        factors: { profile_fit: detail, risk_fit: detail, fundamentals: detail, diversification: detail },
        total,
    };
}
const crypto = { assetClass: 'crypto' as const, market: 'none' as const, sector: undefined };
const symbols = (list: Candidate[], level: Level = 'Intermediate', previous = NONE, brands: string[] = []) =>
    selectPicks(list, profile(level, 'High', { brands }), RULES, previous, NOW).picks.map((pick) => pick.symbol);

describe('selection: top N by level', () => {
    const many = Array.from({ length: 25 }, (_, i) => scored(`S${String(i).padStart(2, '0')}`, 90 - i));
    it.each([['Novice', 5], ['Intermediate', 10], ['Expert', 20]] as Array<[Level, number]>)('%s gets %i picks', (level, n) => {
        const picks = selectPicks(many, profile(level, 'Medium'), RULES, NONE, NOW).picks;
        expect(picks.map((pick) => pick.symbol)).toEqual(many.slice(0, n).map((c) => c.symbol));
        expect(picks.map((pick) => pick.rank)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
    });
    it('returns fewer when fewer candidates passed', () => {
        expect(symbols(many.slice(0, 3), 'Expert')).toEqual(['S00', 'S01', 'S02']);
    });
    it('ignores candidates that failed a filter or were not scored', () => {
        const failedOne: Candidate = { ...scored('BAD', 99), passed: false };
        const unscored: Candidate = { symbol: 'RAW', signals: signals('RAW'), filters: [], passed: true };
        expect(symbols([failedOne, unscored, scored('OK', 10)])).toEqual(['OK']);
    });
});

describe('selection: caps', () => {
    it('keeps at most 2 per sector and moves on to the next best', () => {
        const list = [
            scored('T1', 90, { sector: 'Tech' }), scored('T2', 85, { sector: 'Tech' }), scored('T3', 80, { sector: 'Tech' }), scored('T4', 75, { sector: 'Tech' }),
            scored('H1', 70, { sector: 'Health' }), scored('E1', 60, { sector: 'Energy' }),
        ];
        expect(symbols(list)).toEqual(['T1', 'T2', 'H1', 'E1']);
    });
    it('does not cap assets that have no sector (ETFs)', () => {
        const etf = { assetClass: 'etf' as const, sector: undefined };
        expect(symbols([scored('F1', 90, etf), scored('F2', 80, etf), scored('F3', 70, etf)])).toEqual(['F1', 'F2', 'F3']);
    });
    it('keeps at most 1 crypto: the higher total', () => {
        expect(symbols([scored('BTC', 60, crypto), scored('ETH', 70, crypto), scored('AAA', 50)])).toEqual(['ETH', 'AAA']);
    });
    it('keeps 1 crypto even when both are on the brands list', () => {
        expect(symbols([scored('BTC', 60, crypto), scored('ETH', 70, crypto)], 'Expert', NONE, ['BTC', 'ETH'])).toEqual(['ETH']);
    });
});

describe('selection: seeds', () => {
    const better = Array.from({ length: 6 }, (_, i) => scored(`B${i}`, 80 - i));
    it('keeps a seed that passed the filters even when its total is outside the top N', () => {
        const picks = selectPicks([...better, scored('KO', 10)], profile('Novice', 'Medium', { brands: ['ko'] }), RULES, NONE, NOW).picks;
        expect(picks.map((pick) => pick.symbol)).toEqual(['B0', 'B1', 'B2', 'B3', 'KO']);
        expect(picks.map((pick) => pick.kept)).toEqual(['new', 'new', 'new', 'new', 'seed']);
        expect(picks[4].rank).toBe(5);   // ranked by its score, not promoted
    });
    it('does not keep a seed that failed a filter', () => {
        const failedSeed: Candidate = { ...scored('KO', 99), passed: false };
        expect(symbols([...better, failedSeed], 'Novice', NONE, ['KO'])).toEqual(['B0', 'B1', 'B2', 'B3', 'B4']);
    });
    it('lets seeds exceed the sector cap, and they use up the sector for the others', () => {
        const list = [
            scored('T1', 90, { sector: 'Tech' }), scored('T2', 85, { sector: 'Tech' }),
            scored('S1', 40, { sector: 'Tech' }), scored('S2', 30, { sector: 'Tech' }), scored('S3', 20, { sector: 'Tech' }),
            scored('H1', 50, { sector: 'Health' }),
        ];
        expect(symbols(list, 'Intermediate', NONE, ['S1', 'S2', 'S3'])).toEqual(['H1', 'S1', 'S2', 'S3']);
    });
    it('takes the best N seeds when there are more seeds than places', () => {
        const seeds = Array.from({ length: 7 }, (_, i) => scored(`K${i}`, 50 - i));
        expect(symbols([...better, ...seeds], 'Novice', NONE, seeds.map((c) => c.symbol))).toEqual(['K0', 'K1', 'K2', 'K3', 'K4']);
    });
});

describe('selection: tie-break', () => {
    it('higher total first, then lower volatility, then ticker A-Z', () => {
        const list = [
            scored('ZED', 70, {}, 0.2), scored('ABC', 70, {}, 0.3), scored('MID', 70, {}, 0.2), scored('TOP', 70.1, {}, 0.6), scored('AAA', 69.9, {}, 0.01),
        ];
        expect(symbols(list)).toEqual(['TOP', 'MID', 'ZED', 'ABC', 'AAA']);
    });
    it('decides who gets the last place the same way', () => {
        const list = [...Array.from({ length: 4 }, (_, i) => scored(`B${i}`, 90 - i)), scored('ZED', 70, {}, 0.2), scored('ABC', 70, {}, 0.3), scored('MID', 70, {}, 0.2)];
        expect(symbols(list, 'Novice')).toEqual(['B0', 'B1', 'B2', 'B3', 'MID']);
    });
    it('puts a candidate with no volatility after one that has it', () => {
        const noVolatility = scored('AAA', 70);
        delete noVolatility.signals.volatility1y;
        expect(symbols([noVolatility, scored('ZZZ', 70, {}, 0.79)])).toEqual(['ZZZ', 'AAA']);
    });
});

describe('selection: newcomer margin (5 points)', () => {
    // A Novice list of 5; all listed 30 days ago, so only the margin protects them.
    const listed = [scored('L1', 80), scored('L2', 78), scored('L3', 76), scored('L4', 74), scored('L5', 70)];
    const previous: PreviousList = { previousPicks: listed.map((c) => c.symbol), listedSince: Object.fromEntries(listed.map((c) => [c.symbol, daysAgo(30)])) };
    const run = (newcomerTotal: number) => selectPicks([...listed, scored('NEW', newcomerTotal)], profile('Novice', 'Medium'), RULES, previous, NOW);

    it('a newcomer ahead by less than the margin does not take the place', () => {
        expect(run(73).picks.map((pick) => pick.symbol)).toEqual(['L1', 'L2', 'L3', 'L4', 'L5']);
    });
    it('a newcomer ahead by exactly the margin does not take the place', () => {
        expect(run(75).picks.map((pick) => pick.symbol)).toEqual(['L1', 'L2', 'L3', 'L4', 'L5']);
    });
    it('a newcomer ahead by more than the margin takes it, and is ranked by its score', () => {
        const result = run(75.1);
        expect(result.picks.map((pick) => pick.symbol)).toEqual(['L1', 'L2', 'L3', 'NEW', 'L4']);
        expect(result.picks.map((pick) => pick.kept)).toEqual(['incumbent', 'incumbent', 'incumbent', 'new', 'incumbent']);
    });
    it('without a previous list the higher total simply wins', () => {
        expect(symbols([...listed, scored('NEW', 73)], 'Novice')).toEqual(['L1', 'L2', 'L3', 'L4', 'NEW']);
    });
    it('the margin also holds inside a full sector', () => {
        const tech = [scored('T1', 80, { sector: 'Tech' }), scored('T2', 70, { sector: 'Tech' })];
        const before: PreviousList = { previousPicks: ['T1', 'T2'], listedSince: { T1: daysAgo(30), T2: daysAgo(30) } };
        const pick = (total: number) => selectPicks([...tech, scored('T3', total, { sector: 'Tech' })], profile('Expert', 'Medium'), RULES, before, NOW).picks.map((p) => p.symbol);
        expect(pick(75)).toEqual(['T1', 'T2']);
        expect(pick(76)).toEqual(['T1', 'T3']);
    });
    it('a listed symbol that no longer passes the filters is dropped at once', () => {
        const withoutL1 = [...listed.slice(1), scored('NEW', 10)];
        expect(selectPicks(withoutL1, profile('Novice', 'Medium'), RULES, previous, NOW).picks.map((pick) => pick.symbol)).toEqual(['L2', 'L3', 'L4', 'L5', 'NEW']);
    });
});

describe('selection: minimum of 7 days on the list', () => {
    const strong = [scored('N1', 95), scored('N2', 94), scored('N3', 93), scored('N4', 92), scored('N5', 91)];
    const weak = scored('OLD', 20);
    const run = (days: number) => selectPicks([...strong, weak], profile('Novice', 'Medium'), RULES, { previousPicks: ['OLD'], listedSince: { OLD: daysAgo(days) } }, NOW);

    it.each([0, 1, 6, 6.99])('listed %f days ago: stays, whatever the newcomers score', (days) => {
        expect(run(days).picks.map((pick) => pick.symbol)).toEqual(['N1', 'N2', 'N3', 'N4', 'OLD']);
    });
    it.each([7, 8, 30])('listed %f days ago: no longer protected', (days) => {
        expect(run(days).picks.map((pick) => pick.symbol)).toEqual(['N1', 'N2', 'N3', 'N4', 'N5']);
    });
    it('leaves earlier if it fails a filter', () => {
        const failing: Candidate = { ...weak, passed: false };
        const result = selectPicks([...strong, failing], profile('Novice', 'Medium'), RULES, { previousPicks: ['OLD'], listedSince: { OLD: daysAgo(1) } }, NOW);
        expect(result.picks.map((pick) => pick.symbol)).toEqual(['N1', 'N2', 'N3', 'N4', 'N5']);
    });
    it('treats a listed symbol with no known date as listed today', () => {
        const result = selectPicks([...strong, weak], profile('Novice', 'Medium'), RULES, { previousPicks: ['OLD'], listedSince: {} }, NOW);
        expect(result.picks.map((pick) => pick.symbol)).toContain('OLD');
        expect(result.listedSince.OLD).toBe(NOW);
    });
});

describe('selection: listing dates for the next run', () => {
    it('keeps the date of a symbol that stays and stamps a new one with now', () => {
        const previous: PreviousList = { previousPicks: ['AAA', 'GONE'], listedSince: { AAA: daysAgo(3), GONE: daysAgo(9) } };
        const result = selectPicks([scored('AAA', 50), scored('BBB', 60)], profile('Expert', 'Medium'), RULES, previous, NOW);
        expect(result.listedSince).toEqual({ AAA: daysAgo(3), BBB: NOW });
    });
});

describe('selection: determinism', () => {
    const list = [
        scored('T1', 90, { sector: 'Tech' }), scored('T2', 85, { sector: 'Tech' }), scored('T3', 85, { sector: 'Tech' }, 0.2), scored('BTC', 60, crypto), scored('ETH', 60, crypto),
        scored('H1', 70, { sector: 'Health' }), scored('H2', 70, { sector: 'Health' }), scored('E1', 70, { sector: 'Energy' }), scored('KO', 5, { sector: 'Staples' }),
    ];
    const previous: PreviousList = { previousPicks: ['T2', 'H2', 'E1'], listedSince: { T2: daysAgo(10), H2: daysAgo(2), E1: daysAgo(40) } };
    const who = profile('Novice', 'High', { brands: ['KO'] });

    it('same input twice gives the same output', () => {
        expect(selectPicks(list, who, RULES, previous, NOW)).toEqual(selectPicks(list, who, RULES, previous, NOW));
    });
    it('the order of the candidates does not matter', () => {
        const expected = selectPicks(list, who, RULES, previous, NOW);
        expect(selectPicks(shuffled(list), who, RULES, previous, NOW)).toEqual(expected);
        expect(selectPicks([...list].reverse(), who, RULES, previous, NOW)).toEqual(expected);
        // KO is a seed, H2 is inside its 7 days; T2 (listed, 85 + 5) is ahead of T3 (85); T1 is next; then E1 (listed, 70 + 5).
        expect(expected.picks.map((pick) => pick.symbol)).toEqual(['T1', 'T2', 'E1', 'H2', 'KO']);
    });
    it('does not change its input', () => {
        const copy = structuredClone(list);
        selectPicks(list, who, RULES, previous, NOW);
        expect(list).toEqual(copy);
    });
});
