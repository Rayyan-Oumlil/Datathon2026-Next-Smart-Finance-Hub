// Inputs a provider fault or an odd name could produce. Each case here failed, or was unguarded, before a fix.
import { describe, expect, it } from 'vitest';
import type { Candidate, Pick as WatchlistPick, Snapshot } from '@/lib/domain/types';
import { RULES } from '@/lib/rules';
import { runFilters } from '@/lib/watchlist/filters';
import { runPipeline } from '@/lib/watchlist/pipeline';
import { buildReason, containsNeverWord } from '@/lib/watchlist/reasons';
import { scoreCandidate } from '@/lib/watchlist/score';
import { selectPicks } from '@/lib/watchlist/selection';
import { EMPTY_HOLDINGS, NOW, entry, profile, signals, withoutTextRefs } from './fixtures';

const snapshotOf = (list: ReturnType<typeof signals>[], level: 'Novice' | 'Intermediate' | 'Expert' = 'Expert', risk: 'Low' | 'Medium' | 'High' = 'Medium'): Snapshot => ({
    id: 'snap', takenAt: NOW, userId: 'demo',
    profile: { ...profile(level, risk), ruleVersions: { level: 'level-v1', risk: 'risk-v1' } },
    holdings: EMPTY_HOLDINGS,
    signals: list,
});

describe('a negative volatility is a fault, not a low volatility', () => {
    const faulty = signals('NEG', {}, { volatility: -0.1 });
    it.each(['Low', 'Medium', 'High'] as const)('fails the candidate as missing data for %s risk', (risk) => {
        const checks = runFilters(faulty, profile('Expert', risk), RULES);
        expect(withoutTextRefs(checks.filter((check) => !check.pass))).toEqual([
            { filter: 'data', pass: false, detail: '1-year volatility -10.0% is negative, which is not a valid value, so the volatility cap cannot be checked' },
        ]);
        expect(checks.some((check) => check.filter === 'volatility')).toBe(false);
    });
    it('a volatility of exactly 0 is still a value and passes the cap', () => {
        const checks = runFilters(signals('ZERO', {}, { volatility: 0 }), profile('Expert', 'Low', {}), RULES);
        expect(checks.find((check) => check.filter === 'volatility')?.pass).toBe(true);
    });
    it.each(['Low', 'Medium', 'High'] as const)('never gives a risk fit outside 0-100 (%s)', (risk) => {
        const { factors, total } = scoreCandidate(faulty, profile('Expert', risk), RULES, { sectorMedianPe: {}, holdings: EMPTY_HOLDINGS });
        expect(factors.risk_fit).toMatchObject({ score: 0, noData: true });
        expect(Number.isFinite(total)).toBe(true);
    });
    it('is rejected by the pipeline, never ranked', () => {
        const { result } = runPipeline({ snapshot: snapshotOf([faulty], 'Expert', 'Low'), universe: [faulty.entry], rules: RULES, now: NOW });
        expect(result.picks).toEqual([]);
        expect(result.rejected.map((r) => [r.symbol, r.failed.map((check) => check.filter)])).toEqual([['NEG', ['data']]]);
    });
});

describe('never-words: the possessive of "fits you"', () => {
    it.each(['This fits your profile', 'It fits yours', 'FITS YOUR goals', 'a fund fitting your plan'])('finds it in "%s"', (text) => {
        expect(containsNeverWord(text)).toBe(true);
    });
    it.each(['In Health Care, a sector you picked', 'On your brands list', 'Same sector as KO, which you hold', 'the outfit you saw'])('leaves "%s" alone', (text) => {
        expect(containsNeverWord(text)).toBe(false);
    });
});

describe('the move sentence shows the sign of the rounded number', () => {
    const pickOf = (change: number): WatchlistPick => ({
        rank: 1, symbol: 'MOV', name: 'MOV Inc.', assetClass: 'stock', total: 50,
        factors: {} as WatchlistPick['factors'], topDrivers: [], reason: null,
        signals: signals('MOV', { sector: undefined }, { change }),
    });
    it.each([[-0.04, 'Moved 0.0% today'], [0.04, 'Moved 0.0% today'], [0, 'Moved 0.0% today'], [0.06, 'Moved +0.1% today'], [-0.06, 'Moved -0.1% today'], [-12.34, 'Moved -12.3% today']])(
        '%f -> %s', (change, text) => {
            expect(buildReason(pickOf(change), profile('Expert', 'Medium'), EMPTY_HOLDINGS)?.text).toBe(text);
        });
});

describe('names that are also members of every object', () => {
    const detail = { score: 50, detail: 'fixture' };
    const scored = (symbol: string, total: number, sector: string): Candidate => ({
        symbol, signals: signals(symbol, { sector }), filters: [], passed: true,
        factors: { profile_fit: detail, risk_fit: detail, fundamentals: detail, diversification: detail }, total,
    });
    it('the sector cap still holds for a sector called "constructor"', () => {
        const list = [scored('A', 90, 'constructor'), scored('B', 80, 'constructor'), scored('C', 70, 'constructor'), scored('D', 60, 'toString')];
        expect(selectPicks(list, profile('Expert', 'Medium'), RULES, { listedSince: {}, previousPicks: [] }, NOW).picks.map((pick) => pick.symbol)).toEqual(['A', 'B', 'D']);
    });
    it('a listed symbol called "constructor" gets a real listing date', () => {
        const { listedSince } = selectPicks([scored('constructor', 90, 'Tech')], profile('Expert', 'Medium'), RULES, { listedSince: {}, previousPicks: ['constructor'] }, NOW);
        expect(listedSince).toEqual({ constructor: NOW });
    });
    it('diversification does not take such a sector for a held one', () => {
        const holdings = { totalValueCad: 0, bySector: {}, byAssetClass: {}, symbols: [] };
        const { factors } = scoreCandidate(signals('Q', { sector: 'constructor' }), profile('Expert', 'Medium'), RULES, { sectorMedianPe: {}, holdings });
        expect(factors.diversification.score).toBe(100);
        expect(factors.fundamentals).toMatchObject({ score: 50, noData: true });
    });
});

describe('pipeline: empty and repeated runs', () => {
    it('an empty universe gives an empty result', () => {
        const { result, candidates, next } = runPipeline({ snapshot: snapshotOf([]), universe: [], rules: RULES, now: NOW });
        expect(result).toMatchObject({ picks: [], referenceCards: [], rejected: [], candidates: 0 });
        expect(candidates).toEqual([]);
        expect(next).toEqual({ listedSince: {}, previousPicks: [] });
    });
    it('a universe with no signals collected rejects every row as missing data, reference cards included', () => {
        const universe = [entry('AAA'), entry('GOLD', { assetClass: 'gold', market: 'none', sector: undefined })];
        const { result } = runPipeline({ snapshot: snapshotOf([]), universe, rules: RULES, now: NOW });
        expect(result.picks).toEqual([]);
        expect(result.referenceCards).toEqual([]);
        expect(result.rejected.map((r) => [r.symbol, r.failed[0].filter])).toEqual([['AAA', 'data'], ['GOLD', 'data']]);
    });
    it('running again on the same snapshot with the list just produced changes nothing but the kept flag', () => {
        const list = Array.from({ length: 30 }, (_, i) => signals(`S${String(i).padStart(2, '0')}`, { sector: `Sector ${i % 9}` }, { volatility: 0.2 + (i % 7) / 100, pe: 10 + i, growth: i - 5 }));
        const universe = list.map((set) => set.entry);
        const first = runPipeline({ snapshot: snapshotOf(list), universe, rules: RULES, now: NOW });
        const second = runPipeline({ snapshot: snapshotOf(list), universe, rules: RULES, previous: first.next, now: '2026-11-14T18:00:00.000Z' });
        expect(second.result.picks.map((pick) => [pick.rank, pick.symbol, pick.total])).toEqual(first.result.picks.map((pick) => [pick.rank, pick.symbol, pick.total]));
        expect(second.result.picks.every((pick) => pick.kept === 'incumbent')).toBe(true);
        expect(second.next).toEqual(first.next);   // listing dates are kept, not restamped
    });
});
