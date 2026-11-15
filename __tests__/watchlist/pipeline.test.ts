import { describe, expect, it } from 'vitest';
import type { SignalSet, Snapshot, UniverseEntry } from '@/lib/domain/types';
import { RULES } from '@/lib/rules';
import { runPipeline } from '@/lib/watchlist/pipeline';
import { containsNeverWord } from '@/lib/watchlist/reasons';
import { renderCandidate, renderRun } from '@/lib/watchlist/render';
import { EMPTY_HOLDINGS, NOW, answers, shuffled, signals, sourced, withoutTextRefs } from './fixtures';

// A hand-built snapshot of 26 universe rows. Profile: Intermediate (10 picks), Medium risk, both markets,
// sectors Information Technology + Health Care, niche Semiconductors, theme dividends, brand KO, avoid AAE.
// Holdings are empty, so diversification is 100 for everyone (15 points of each total).
const IT = 'Information Technology';
const HC = 'Health Care';
const FIN = 'Financials';
const noSector = { sector: undefined, subIndustry: undefined };
const etf = { ...noSector, assetClass: 'etf' as const };
const offMarket = { ...noSector, market: 'none' as const };

const fnbTo = signals('FNB.TO', { sector: FIN, subIndustry: 'Diversified Banks', market: 'Canada', themes: ['dividends'] }, { volatility: 0.18, pe: 14 });
fnbTo.marketCapUsd = sourced(5e9, { currency: 'CAD', source: 'TMX Money (delayed 15 min or more)' });   // 5.0B CAD / 1.25 = US$4.0B
fnbTo.missing = ['revenueGrowthPct', 'changePercent'];

const SIGNALS: SignalSet[] = [
    // Information Technology (picked). Median P/E of those that pass: 20, 30, 40 -> 30.
    signals('AAA', { sector: IT, subIndustry: 'Semiconductors' }, { volatility: 0.30, pe: 20, growth: 20, change: 0.5 }),
    signals('AAB', { sector: IT }, { volatility: 0.25, pe: 40, growth: 5, change: -1.1 }),
    signals('AAC', { sector: IT }, { volatility: 0.15, pe: 30, growth: -10, change: 0.2 }),
    signals('AAD', { sector: IT, subIndustry: 'Semiconductors' }, { volatility: 0.41, pe: 25, growth: 30 }),   // volatility above 35%
    signals('AAE', { sector: IT }, { pe: 25, growth: 30 }),                                                    // on the avoid list
    signals('AAF', { sector: IT }, { marketCap: 1.5e9, pe: 25, growth: 30 }),                                  // under the US$2B floor
    signals('AAG', { sector: IT }, { traded: 0.5e6, pe: 25, growth: 30 }),                                     // under US$1M a day
    signals('AAH', { sector: IT }, { volatility: undefined, pe: 25, growth: 30 }),                             // no volatility
    // AAI is in the universe but has no signals at all in the snapshot.
    // Health Care (picked). Median P/E: 15, 30, 60 -> 30.
    signals('HCA', { sector: HC, subIndustry: 'Biotechnology' }, { volatility: 0.22, pe: 15, growth: 10, change: 1.0 }),
    signals('HCB', { sector: HC, subIndustry: 'Biotechnology' }, { volatility: 0.28, pe: 30, growth: 0, change: 1.0 }),
    signals('HCC', { sector: HC, subIndustry: 'Biotechnology' }, { volatility: 0.33, pe: 60, growth: 20, change: 1.0 }),
    // Not picked sectors, reached through the dividends theme or the brands list.
    signals('FNA', { sector: FIN, subIndustry: 'Diversified Banks', themes: ['dividends'] }, { volatility: 0.20, pe: 10, growth: 5, change: 1.23 }),
    fnbTo,
    signals('FNC', { sector: FIN, subIndustry: 'Diversified Banks' }, { pe: 5, growth: 50 }),                  // no theme: not a candidate
    signals('KO', { sector: 'Consumer Staples', subIndustry: 'Soft Drinks' }, { volatility: 0.14, pe: 24, growth: 2, change: 0.3 }),
    signals('CSB', { sector: 'Consumer Staples', subIndustry: 'Soft Drinks' }, { pe: 5, growth: 50 }),         // not a candidate
    signals('ENA', { sector: 'Energy', subIndustry: 'Integrated Oil & Gas', themes: ['dividends'] }, { volatility: 0.34, pe: 8, growth: -4, closes: [100, 105, 110] }),
    // ETFs
    signals('ETA', { ...etf, themes: ['dividends'], blueChipEtf: true, etf: { index: 'S&P 500', holdings: 503, issuerUrl: 'https://issuer.example/eta' } }, { volatility: 0.16, marketCap: undefined, change: 0.1 }),
    signals('ETB.TO', { ...etf, market: 'Canada', themes: ['dividends'], etf: { index: 'S&P/TSX 60', issuerUrl: 'https://issuer.example/etb' } }, { volatility: 0.21, marketCap: undefined, change: 0.1 }),
    signals('ETC', etf, { marketCap: undefined }),                                                             // no theme: not a candidate
    // Crypto (High risk only), gold and bond yields (reference cards).
    signals('BTC', { ...offMarket, assetClass: 'crypto' }, { volatility: 0.30, marketCap: undefined, traded: undefined }),
    signals('ETH', { ...offMarket, assetClass: 'crypto' }, { volatility: 0.30, marketCap: undefined, traded: undefined }),
    signals('GOLD', { ...offMarket, assetClass: 'gold' }, { volatility: undefined, marketCap: undefined, traded: undefined }),
    signals('CA5Y', { ...offMarket, assetClass: 'bond_yield' }, { volatility: undefined, marketCap: undefined, traded: undefined }),
    signals('CA10Y', { ...offMarket, assetClass: 'bond_yield' }, { volatility: undefined, marketCap: undefined, traded: undefined }),
];
const UNIVERSE: UniverseEntry[] = [...SIGNALS.map((set) => set.entry), signals('AAI', { sector: IT }).entry];

const SNAPSHOT: Snapshot = {
    id: 'snap-2026-11-14',
    takenAt: NOW,
    userId: 'demo',
    profile: {
        level: 'Intermediate',
        risk: 'Medium',
        answers: answers({ markets: 'global', sectors: [IT, HC], niches: ['Semiconductors'], themes: ['dividends'], brands: ['KO'], avoid: ['AAE'] }),
        ruleVersions: { level: 'level-v1', risk: 'risk-v1' },
    },
    holdings: EMPTY_HOLDINGS,
    fxUsdCad: sourced(1.25, { source: 'Bank of Canada', asOf: '2026-11-13' }),
    signals: SIGNALS,
};

const run = (snapshot = SNAPSHOT, universe = UNIVERSE, previous?: Parameters<typeof runPipeline>[0]['previous'], now = NOW) =>
    runPipeline({ snapshot, universe, rules: RULES, previous, now });

describe('pipeline: full run on the hand-built snapshot', () => {
    const { result, candidates, next } = run();

    it('reports the run', () => {
        expect(result.snapshotId).toBe('snap-2026-11-14');
        expect(result.computedAt).toBe(NOW);
        expect(result.level).toBe('Intermediate');
        expect(result.risk).toBe('Medium');
        expect(result.ruleVersions).toEqual({ filters: 'filters-v1', score: RULES.score.version, selection: 'selection-v1', reasons: 'reasons-v1' });
    });

    it('builds the candidate list: 26 rows minus the 3 nobody asked for', () => {
        expect(result.candidates).toBe(23);
        expect(candidates.map((c) => c.symbol)).toEqual([
            'AAA', 'AAB', 'AAC', 'AAD', 'AAE', 'AAF', 'AAG', 'AAH', 'AAI', 'BTC', 'CA10Y', 'CA5Y', 'ENA', 'ETA', 'ETB.TO', 'ETH', 'FNA', 'FNB.TO', 'GOLD', 'HCA', 'HCB', 'HCC', 'KO',
        ]);
    });

    // Totals worked by hand: (40 x fit + 25 x risk + 20 x fundamentals + 15 x 100) / 100.
    //   AAA  fit 60 (sector + niche)  risk 100   fund (88.9 + 100) / 2 = 94.4   -> 24 + 25     + 18.88 + 15 = 82.9
    //   HCA  fit 40                   risk 100   fund (100 + 66.7) / 2 = 83.3   -> 16 + 25     + 16.66 + 15 = 72.7
    //   HCB  fit 40                   risk 100   fund (66.7 + 33.3) / 2 = 50.0  -> 16 + 25     + 10    + 15 = 66.0
    //   HCC  fit 40                   risk 100   fund (0 + 100) / 2 = 50.0      -> 66.0, tied with HCB; higher volatility; third in its sector
    //   AAB  fit 40                   risk 100   fund (44.4 + 50) / 2 = 47.2    -> 16 + 25     + 9.44  + 15 = 65.4
    //   FNA  fit 20 (theme)           risk 100   fund (77.8 + 50) / 2 = 63.9    -> 8  + 25     + 12.78 + 15 = 60.8
    //   AAC  fit 40                   risk 87.5  fund (66.7 + 0) / 2 = 33.3     -> 16 + 21.875 + 6.66  + 15 = 59.5, third in its sector
    //   ETB.TO fit 20                 risk 100   fund 50 (no data)              -> 8  + 25     + 10    + 15 = 58.0
    //   FNB.TO fit 20                 risk 95    fund 55.6 (P/E only)           -> 8  + 23.75  + 11.12 + 15 = 57.9
    //   ENA  fit 20                   risk 100   fund (66.7 + 20) / 2 = 43.3    -> 8  + 25     + 8.66  + 15 = 56.7
    //   ETA  fit 20                   risk 90    fund 50 (no data)              -> 8  + 22.5   + 10    + 15 = 55.5
    //   KO   fit 20 (brand)           risk 85    fund (66.7 + 40) / 2 = 53.3    -> 8  + 21.25  + 10.66 + 15 = 54.9
    it('ranks exactly these ten picks, with these totals', () => {
        expect(result.picks.map((pick) => [pick.rank, pick.symbol, pick.total, pick.kept])).toEqual([
            [1, 'AAA', 82.9, 'new'],
            [2, 'HCA', 72.7, 'new'],
            [3, 'HCB', 66.0, 'new'],
            [4, 'AAB', 65.4, 'new'],
            [5, 'FNA', 60.8, 'new'],
            [6, 'ETB.TO', 58.0, 'new'],
            [7, 'FNB.TO', 57.9, 'new'],
            [8, 'ENA', 56.7, 'new'],
            [9, 'ETA', 55.5, 'new'],
            [10, 'KO', 54.9, 'seed'],
        ]);
    });

    it('scores every factor as worked by hand', () => {
        const factorScores = Object.fromEntries(candidates.filter((c) => c.factors).map((c) => [
            c.symbol, [c.factors!.profile_fit.score, c.factors!.risk_fit.score, c.factors!.fundamentals.score, c.factors!.diversification.score, c.total],
        ]));
        expect(factorScores).toEqual({
            AAA: [60, 100, 94.4, 100, 82.9],
            AAB: [40, 100, 47.2, 100, 65.4],
            AAC: [40, 87.5, 33.3, 100, 59.5],
            ENA: [20, 100, 43.3, 100, 56.7],
            ETA: [20, 90, 50, 100, 55.5],
            'ETB.TO': [20, 100, 50, 100, 58.0],
            FNA: [20, 100, 63.9, 100, 60.8],
            'FNB.TO': [20, 95, 55.6, 100, 57.9],
            HCA: [40, 100, 83.3, 100, 72.7],
            HCB: [40, 100, 50, 100, 66.0],
            HCC: [40, 100, 50, 100, 66.0],
            KO: [20, 85, 53.3, 100, 54.9],
        });
        expect(candidates.find((c) => c.symbol === 'ETA')!.factors!.fundamentals.noData).toBe(true);
    });

    it('leaves out the third of a sector: AAC and HCC passed and were scored but are not picked', () => {
        const symbols = result.picks.map((pick) => pick.symbol);
        expect(symbols).not.toContain('AAC');
        expect(symbols).not.toContain('HCC');
        expect(result.rejected.map((r) => r.symbol)).not.toContain('AAC');
    });

    it('names the top two drivers', () => {
        const drivers = Object.fromEntries(result.picks.map((pick) => [pick.symbol, pick.topDrivers]));
        expect(drivers.AAA).toEqual(['risk_fit', 'profile_fit']);        // 25 and 24
        expect(drivers.HCA).toEqual(['risk_fit', 'fundamentals']);       // 25 and 16.66
        expect(drivers.KO).toEqual(['risk_fit', 'diversification']);     // 21.25 and 15
    });

    it('writes one fact sentence per pick, or none', () => {
        expect(result.picks.map((pick) => [pick.symbol, pick.reason?.templateId ?? null, pick.reason?.text ?? null])).toEqual([
            ['AAA', 'picked_sector', 'In Information Technology, a sector you picked'],
            ['HCA', 'picked_sector', 'In Health Care, a sector you picked'],
            ['HCB', 'picked_sector', 'In Health Care, a sector you picked'],
            ['AAB', 'picked_sector', 'In Information Technology, a sector you picked'],
            ['FNA', 'moved', 'Moved +1.2% today'],
            ['ETB.TO', 'etf_tracks', 'ETF that tracks S&P/TSX 60'],
            ['FNB.TO', null, null],
            ['ENA', 'moved', 'Moved +10.0% over 1 month'],
            ['ETA', 'etf_tracks', 'ETF that tracks S&P 500'],
            ['KO', 'brands_list', 'On your brands list'],
        ]);
        for (const pick of result.picks) {
            if (pick.reason) {
                expect(containsNeverWord(pick.reason.text)).toBe(false);
                expect(pick.reason.sources.length).toBeGreaterThan(0);
            }
        }
    });

    it('rejects the rest with the failed filter and the actual values', () => {
        expect(result.rejected.map((r) => [r.symbol, r.failed.map((check) => `${check.filter}: ${check.detail}`)])).toEqual([
            ['AAD', ['volatility: volatility 41.0% is above the 35.0% cap for Medium risk']],
            ['AAE', ['avoid_list: AAE is on the avoid list']],
            ['AAF', ['market_cap_floor: market cap US$1.5B is below the US$2.0B floor for Medium risk']],
            ['AAG', ['liquidity: average traded value US$500,000 a day is below the US$1.0M a day minimum']],
            ['AAH', ['data: 1-year volatility is missing, so the volatility cap cannot be checked']],
            ['AAI', ['data: no signals were collected for AAI in this snapshot']],
            ['BTC', ["crypto_risk: crypto is listed for High risk only; the profile's risk is Medium"]],
            ['ETH', ["crypto_risk: crypto is listed for High risk only; the profile's risk is Medium"]],
        ]);
    });

    it('converts the Canadian market cap before the floor', () => {
        const check = candidates.find((c) => c.symbol === 'FNB.TO')!.filters.find((f) => f.filter === 'market_cap_floor')!;
        expect(check).toMatchObject({ pass: true, value: 4e9, detail: 'market cap US$4.0B is above the US$2.0B floor for Medium risk' });
    });

    it('shows gold and bond yields as reference cards, never ranked', () => {
        expect(result.referenceCards.map((card) => card.symbol)).toEqual(['CA10Y', 'CA5Y', 'GOLD']);
        expect(result.picks.some((pick) => pick.assetClass === 'gold' || pick.assetClass === 'bond_yield')).toBe(false);
        const gold = candidates.find((c) => c.symbol === 'GOLD')!;
        expect(gold.passed).toBe(true);
        expect(gold.factors).toBeUndefined();
        expect(gold.total).toBeUndefined();
    });

    it('keeps every pick tied to its signals', () => {
        for (const pick of result.picks) expect(pick.signals).toBe(SIGNALS.find((set) => set.symbol === pick.symbol));
    });

    it('returns what the next run needs', () => {
        expect(next.previousPicks).toEqual(result.picks.map((pick) => pick.symbol));
        expect(next.listedSince).toEqual(Object.fromEntries(result.picks.map((pick) => [pick.symbol, NOW])));
    });
});

describe('pipeline: other profiles on the same snapshot', () => {
    const withProfile = (over: Partial<Snapshot['profile']>, answerOver = {}): Snapshot => ({
        ...SNAPSHOT,
        profile: { ...SNAPSHOT.profile, ...over, answers: { ...SNAPSHOT.profile.answers, ...answerOver } },
    });

    it('High risk: one crypto at most, and the avoid list removes gold', () => {
        const { result } = run(withProfile({ level: 'Expert', risk: 'High' }, { avoid: ['AAE', 'GOLD'] }));
        const cryptoPicks = result.picks.filter((pick) => pick.assetClass === 'crypto').map((pick) => pick.symbol);
        expect(cryptoPicks).toEqual(['BTC']);   // BTC and ETH have equal totals and volatility: ticker A-Z
        expect(result.referenceCards.map((card) => card.symbol)).toEqual(['CA10Y', 'CA5Y']);
        expect(result.rejected.find((r) => r.symbol === 'GOLD')!.failed[0].detail).toBe('GOLD is on the avoid list');
    });

    it('Novice with Low risk: 5 picks at most, blue-chip ETFs only, no crypto', () => {
        const { result } = run(withProfile({ level: 'Novice', risk: 'Low' }));
        // Volatility cap 20%: only AAC (15%), FNA (20%), FNB.TO (18%, but US$4.0B is under the floor), KO (14%), ETA (16%) remain.
        // Every volatility is inside the Low band (risk fit 100) and each stock is alone in its sector (P/E at the median: 66.7).
        //   AAC 16 + 25 + 6.66 (33.3) + 15 = 62.7 · FNA 8 + 25 + 11.66 (58.3) + 15 = 59.7 · KO 8 + 25 + 10.66 (53.3) + 15 = 58.7 · ETA 8 + 25 + 10 + 15 = 58.0
        expect(result.picks.map((pick) => [pick.symbol, pick.total])).toEqual([['AAC', 62.7], ['FNA', 59.7], ['KO', 58.7], ['ETA', 58.0]]);
        expect(result.rejected.find((r) => r.symbol === 'ETB.TO')!.failed.map((check) => check.filter)).toEqual(['volatility', 'novice', 'low_risk_etf']);
        expect(result.rejected.find((r) => r.symbol === 'FNB.TO')!.failed.map((check) => check.filter)).toEqual(['market_cap_floor', 'novice']);
        expect(result.rejected.find((r) => r.symbol === 'BTC')!.failed.map((check) => check.filter)).toEqual(['volatility', 'crypto_risk', 'novice']);
    });

    it('a brand outside the picked markets is a candidate and is rejected by the market filter', () => {
        const { result } = run(withProfile({}, { markets: 'Canada', brands: ['KO'] }));
        expect(withoutTextRefs(result.rejected.find((r) => r.symbol === 'KO')!.failed)).toEqual([{ filter: 'markets', pass: false, detail: 'KO is listed in US; markets picked: Canada' }]);
        // FNB.TO is now alone in its sector (P/E at the median: 66.7): 8 + 23.75 + 13.34 + 15 = 60.1. ETB.TO stays at 58.0.
        expect(result.picks.map((pick) => [pick.symbol, pick.total])).toEqual([['FNB.TO', 60.1], ['ETB.TO', 58.0]]);
    });

    it('same-sector reason when something in that sector is held', () => {
        const holdings = { totalValueCad: 10000, bySector: { [HC]: 1000 }, byAssetClass: { stock: 1000 }, symbols: ['HCC'] };
        const { result } = run({ ...SNAPSHOT, holdings });
        const hca = result.picks.find((pick) => pick.symbol === 'HCA')!;
        expect(withoutTextRefs(hca.reason)).toEqual({ templateId: 'same_sector_as_holding', text: 'Same sector as HCC, which you hold', sources: ['simulated holdings', 'hand-built test list'] });
        expect(hca.factors.diversification.score).toBe(50);   // Health Care held at 10%
    });
});

describe('pipeline: slow-moving list across days', () => {
    const day1 = run();
    // AAC's growth improves: fundamentals (66.7 + 100) / 2 = 83.3 -> total 16 + 21.875 + 16.66 + 15 = 69.5.
    // That is 4.1 above AAB (65.4), the listed symbol it would replace in the sector: not more than the margin of 5.
    const improved: Snapshot = {
        ...SNAPSHOT,
        id: 'snap-later',
        signals: SIGNALS.map((set) => (set.symbol === 'AAC' ? { ...set, revenueGrowthPct: sourced(20, { unit: '%' }) } : set)),
    };
    const later = '2026-11-24T12:00:00.000Z';   // 10 days on: the 7-day minimum is over, only the margin applies

    it('with no previous list the higher total takes the sector place', () => {
        const symbols = run(improved, UNIVERSE, undefined, later).result.picks.map((pick) => pick.symbol);
        expect(symbols).toContain('AAC');
        expect(symbols).not.toContain('AAB');
    });

    it('a newcomer 4.1 points ahead does not replace a listed symbol', () => {
        const { result, next } = run(improved, UNIVERSE, day1.next, later);
        expect(result.picks.map((pick) => pick.symbol)).toEqual(day1.result.picks.map((pick) => pick.symbol));
        expect(result.picks.find((pick) => pick.symbol === 'AAB')!.kept).toBe('incumbent');
        expect(next.listedSince.AAB).toBe(NOW);   // the first listing date is kept
    });

    it('a newcomer more than 5 points ahead does', () => {
        // P/E 15 too: median of 15, 20, 40 is 20; AAC fundamentals (83.3 + 100) / 2 = 91.7 -> 16 + 21.875 + 18.34 + 15 = 71.2.
        // AAB against the new median: (0 + 50) / 2 = 25 -> 61.0. 71.2 - 61.0 = 10.2 > 5.
        const strong: Snapshot = { ...improved, signals: improved.signals.map((set) => (set.symbol === 'AAC' ? { ...set, pe: sourced(15) } : set)) };
        const { result } = run(strong, UNIVERSE, day1.next, later);
        const symbols = result.picks.map((pick) => pick.symbol);
        expect(symbols).toContain('AAC');
        expect(symbols).not.toContain('AAB');
        expect(result.picks.find((pick) => pick.symbol === 'AAC')).toMatchObject({ total: 71.2, kept: 'new' });
    });

    it('inside the first 7 days a listed symbol stays even against a much stronger newcomer', () => {
        const strong: Snapshot = { ...improved, signals: improved.signals.map((set) => (set.symbol === 'AAC' ? { ...set, pe: sourced(15) } : set)) };
        const symbols = run(strong, UNIVERSE, day1.next, '2026-11-17T12:00:00.000Z').result.picks.map((pick) => pick.symbol);
        expect(symbols).toContain('AAB');
        expect(symbols).not.toContain('AAC');
    });

    it('a listed symbol that now fails a filter leaves at once', () => {
        const failing: Snapshot = { ...SNAPSHOT, signals: SIGNALS.map((set) => (set.symbol === 'AAB' ? { ...set, volatility1y: sourced(0.5) } : set)) };
        const { result } = run(failing, UNIVERSE, day1.next, '2026-11-15T12:00:00.000Z');
        expect(result.picks.map((pick) => pick.symbol)).not.toContain('AAB');
        expect(result.picks.map((pick) => pick.symbol)).toContain('AAC');
        expect(result.rejected.find((r) => r.symbol === 'AAB')!.failed[0].detail).toBe('volatility 50.0% is above the 35.0% cap for Medium risk');
    });
});

describe('pipeline: determinism', () => {
    it('same input twice gives a deep-equal output', () => {
        expect(run()).toEqual(run());
        expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
    });

    it('the order of the universe and of the signals does not change the output', () => {
        const expected = run();
        const reordered = run({ ...SNAPSHOT, signals: shuffled(SIGNALS) }, shuffled(UNIVERSE));
        expect(reordered).toEqual(expected);
        expect(JSON.stringify(reordered)).toBe(JSON.stringify(expected));
        expect(run({ ...SNAPSHOT, signals: [...SIGNALS].reverse() }, [...UNIVERSE].reverse())).toEqual(expected);
    });

    it('holds with a previous list too', () => {
        const day1 = run();
        const later = '2026-11-20T12:00:00.000Z';
        expect(run({ ...SNAPSHOT, signals: shuffled(SIGNALS) }, shuffled(UNIVERSE), day1.next, later)).toEqual(run(SNAPSHOT, UNIVERSE, day1.next, later));
    });

    it('does not change the snapshot or the universe', () => {
        const snapshotCopy = structuredClone(SNAPSHOT);
        const universeCopy = structuredClone(UNIVERSE);
        run();
        expect(SNAPSHOT).toEqual(snapshotCopy);
        expect(UNIVERSE).toEqual(universeCopy);
    });
});

describe('pipeline: English and French', () => {
    const inEnglish = runPipeline({ snapshot: SNAPSHOT, universe: UNIVERSE, rules: RULES, now: NOW, locale: 'en' });
    const inFrench = runPipeline({ snapshot: SNAPSHOT, universe: UNIVERSE, rules: RULES, now: NOW, locale: 'fr' });

    it('the language changes no result: same picks, totals, factors scores, rejections and next state', () => {
        expect(inFrench.result.picks.map((pick) => [pick.rank, pick.symbol, pick.total, pick.kept, pick.topDrivers, pick.reason?.templateId ?? null]))
            .toEqual(inEnglish.result.picks.map((pick) => [pick.rank, pick.symbol, pick.total, pick.kept, pick.topDrivers, pick.reason?.templateId ?? null]));
        expect(inFrench.result.rejected.map((r) => [r.symbol, r.failed.map((check) => [check.filter, check.pass, check.value, check.limit])]))
            .toEqual(inEnglish.result.rejected.map((r) => [r.symbol, r.failed.map((check) => [check.filter, check.pass, check.value, check.limit])]));
        expect(inFrench.next).toEqual(inEnglish.next);
        expect(inEnglish.result.locale).toBe('en');
        expect(inFrench.result.locale).toBe('fr');
    });

    it('a run stored in English, rendered in French, gives the same sentences as a run computed in French (and back)', () => {
        expect(renderRun(inEnglish.result, 'fr')).toEqual(inFrench.result);
        expect(renderRun(inFrench.result, 'en')).toEqual(inEnglish.result);
        expect(inEnglish.candidates.map((c) => renderCandidate(c, 'fr'))).toEqual(inFrench.candidates);
    });

    it('a stored run survives the decision log (JSON) and still renders in the other language', () => {
        const stored = JSON.parse(JSON.stringify(inEnglish.result));
        expect(renderRun(stored, 'fr')).toEqual(JSON.parse(JSON.stringify(inFrench.result)));
    });

    it('is deterministic in each language', () => {
        expect(runPipeline({ snapshot: SNAPSHOT, universe: UNIVERSE, rules: RULES, now: NOW, locale: 'fr' })).toEqual(inFrench);
        expect(runPipeline({ snapshot: { ...SNAPSHOT, signals: shuffled(SIGNALS) }, universe: shuffled(UNIVERSE), rules: RULES, now: NOW, locale: 'fr' })).toEqual(inFrench);
        expect(run()).toEqual(inEnglish);   // English stays the default
    });

    it('writes every French sentence in French, with no never-word', () => {
        const sentences = [
            ...inFrench.result.picks.flatMap((pick) => [pick.reason?.text ?? '', ...Object.values(pick.factors).map((factor) => factor.detail)]),
            ...inFrench.candidates.flatMap((c) => c.filters.map((check) => check.detail)),
        ].filter(Boolean);
        expect(sentences.length).toBeGreaterThan(100);
        for (const sentence of sentences) {
            expect(containsNeverWord(sentence), sentence).toBe(false);
            expect(sentence, sentence).not.toMatch(/\b(is above|is below|was picked|not on the|a day|risk)\b/);
        }
        expect(inFrench.result.rejected.find((r) => r.symbol === 'AAB')).toBeUndefined();
        expect(inFrench.candidates.find((c) => c.symbol === 'AAD')!.filters.find((check) => check.filter === 'volatility')!.detail)
            .toBe('volatilité de 41,0 %, au-dessus du plafond de 35,0 % pour un profil de risque Moyen');
        expect(inFrench.candidates.find((c) => c.symbol === 'AAI')!.filters[0].detail).toBe('aucun signal n’a été recueilli pour AAI dans cet instantané');
    });

    it('a run logged before the catalog (no textRef) is shown as it was written', () => {
        const legacy = withoutTextRefs(inEnglish.result);
        delete legacy.locale;
        const shown = renderRun(legacy, 'fr');
        expect(shown.picks.map((pick) => pick.reason?.text)).toEqual(inEnglish.result.picks.map((pick) => pick.reason?.text));
        expect(shown.locale).toBe('fr');
    });
});
