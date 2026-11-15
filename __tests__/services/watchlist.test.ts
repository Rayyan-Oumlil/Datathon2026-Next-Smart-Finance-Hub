import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_USER } from '@/lib/demo-user';
import type { UniverseEntry } from '@/lib/domain/types';
import { RULE_VERSIONS } from '@/lib/rules';
import { getProfile, listDecisions, readState, updateState } from '@/lib/store';
import { loadDailySignals } from '@/lib/sources/daily-signals';
import { editProfile } from '@/lib/services/profile';
import { buildStatus, buildWatchlist, explainSymbol, getWatchlist, inputsHash, profileHash, refreshWatchlist, userAction } from '@/lib/services/watchlist';
import { simulateTrade } from '@/lib/services/portfolio';
import { answers, freshWorld, market, sourced } from './helpers';

vi.mock('@/lib/services/quotes', async (original) => (await import('./market-stub')).quotesMock(await original()));
vi.mock('@/lib/sources/daily-signals', async (original) => {
    const real = await original<typeof import('@/lib/sources/daily-signals')>();
    const { passing, sourced, NOW } = await import('./market-stub');
    const daily = async (entries: UniverseEntry[]) => ({ date: real.marketDate(), collectedAt: NOW, stale: false, fxUsdCad: sourced(1.42, { source: 'Bank of Canada' }), signals: entries.map(passing) });
    return { ...real, loadDailySignals: vi.fn(daily), refreshDailySignals: vi.fn(daily) };
});

beforeEach(async () => {
    await freshWorld();
    vi.mocked(loadDailySignals).mockClear();
});

const runs = () => listDecisions(DEMO_USER.id, { kind: 'watchlist_run' });
const built = async () => {
    await buildStatus().promise;
    return getWatchlist();
};

describe('watchlist service', () => {
    it('starts a build when there is no run for today and never waits for it', async () => {
        const first = await getWatchlist();
        expect(first).toMatchObject({ result: null, building: true, signalsDate: null });
        expect(first.progress).toMatchObject({ stage: expect.any(String) });
        const view = await built();
        expect(view.building).toBe(false);
        // Two seeds in Information Technology, then at most 2 per sector (2 from Energy). The 8 blue-chip ETFs of both markets are
        // candidates whatever sectors were picked; at most 1 per tracked index, so of the four S&P 500 funds (IVV, SPY, VOO, VFV.TO)
        // only IVV is kept (equal totals and volatility: ticker A-Z). That leaves 9 picks, one short of the Intermediate 10.
        expect(view.result?.picks.map((pick) => pick.symbol)).toEqual(['AAPL', 'SHOP.TO', 'CCO.TO', 'CNQ.TO', 'IVV', 'VCN.TO', 'VTI', 'XIC.TO', 'XIU.TO']);
        const indexes = view.result!.picks.flatMap((pick) => (pick.assetClass === 'etf' ? [pick.signals.entry.etf?.index] : []));
        expect(new Set(indexes).size).toBe(indexes.length);          // no two funds on the same index
        expect(view.result?.picks.filter((pick) => pick.assetClass === 'etf').every((pick) => pick.signals.entry.blueChipEtf === true)).toBe(true);
        expect(view.result).toMatchObject({ level: 'Intermediate', risk: 'Medium' });
        expect(view.result?.picks.map((pick) => pick.symbol)).toEqual(expect.arrayContaining(['AAPL', 'SHOP.TO']));      // seeds are kept
        expect(view.signalsDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('answers needsProfile, and builds nothing, before onboarding', async () => {
        await freshWorld(false);
        expect(await getWatchlist()).toMatchObject({ result: null, building: false, needsProfile: true });
        await expect(buildWatchlist()).rejects.toMatchObject({ status: 409 });
        expect(loadDailySignals).not.toHaveBeenCalled();
    });

    it('logs the whole run: snapshot, every candidate with its filters and scores, rule versions, and one decision per pick', async () => {
        await getWatchlist();
        const view = await built();
        const [run] = await runs();
        const payload = run.payload as { snapshot: { id: string; signals: unknown[]; profile: unknown; holdings: unknown }; candidates: Array<{ symbol: string; filters: unknown[]; passed: boolean; total?: number }>; result: { picks: unknown[] }; profileHash: string };
        expect(run.snapshotId).toBe(payload.snapshot.id);
        expect(run.ruleVersions).toEqual({ filters: 'filters-v1', score: RULE_VERSIONS.score, selection: 'selection-v1', reasons: 'reasons-v1', level: 'level-v1', risk: 'risk-v1' });
        expect(payload.snapshot.signals).toHaveLength(view.result!.candidates);
        expect(payload.snapshot.profile).toMatchObject({ level: 'Intermediate', risk: 'Medium', answers: answers() });
        expect(payload.snapshot.holdings).toEqual({ totalValueCad: 10000, bySector: {}, byAssetClass: {}, symbols: [] });
        expect((run.payload as { holdingsDetail: unknown[] }).holdingsDetail).toEqual([]);
        expect(payload.candidates).toHaveLength(view.result!.candidates);
        expect(payload.candidates.every((candidate) => candidate.filters.length > 0)).toBe(true);
        expect(payload.candidates.filter((candidate) => candidate.passed && candidate.total !== undefined).length).toBeGreaterThan(10);
        expect(payload.candidates.find((candidate) => candidate.symbol === 'BTC')).toMatchObject({ passed: false });
        expect(payload.result.picks).toHaveLength(9);
        expect(payload.candidates.filter((candidate) => ['IVV', 'SPY', 'VOO', 'VTI', 'VCN.TO', 'VFV.TO', 'XIC.TO', 'XIU.TO'].includes(candidate.symbol))).toHaveLength(8);    // every blue-chip ETF, both markets

        const picks = await listDecisions(DEMO_USER.id, { kind: 'pick', snapshotId: run.snapshotId });
        expect(picks.map((pick) => pick.symbol)).toEqual(view.result!.picks.map((pick) => pick.symbol));
        const aapl = picks.find((pick) => pick.symbol === 'AAPL')!.payload as { reason: { templateId: string; text: string; sources: string[] }; sources: Array<{ signal: string; source: string; fetchedAt: string }> };
        expect(aapl.reason.text).toBeTruthy();
        expect(aapl.reason.sources.length).toBeGreaterThan(0);
        expect(aapl.sources).toEqual(expect.arrayContaining([expect.objectContaining({ signal: 'volatility1y', source: 'derived', fetchedAt: expect.any(String) })]));

        const state = await readState();
        expect(state.watchlist.previousPicks).toEqual(view.result!.picks.map((pick) => pick.symbol));
        expect(Object.keys(state.watchlist.listedSince).sort()).toEqual([...state.watchlist.previousPicks].sort());
    });

    it('serves the stored run for the rest of the day without recomputing', async () => {
        await getWatchlist();
        const first = await built();
        const second = await getWatchlist();
        expect(second.result).toEqual(first.result);
        expect(second.building).toBe(false);
        expect(await runs()).toHaveLength(1);
        expect(loadDailySignals).toHaveBeenCalledTimes(1);
    });

    it('gives the same list on a same-day refresh and logs it as a second run', async () => {
        await getWatchlist();
        const first = await built();
        const { started, done } = await buildWatchlist();
        expect(started).toBe(true);
        expect((await buildWatchlist()).started).toBe(false);       // one build at a time
        await done;
        const second = await getWatchlist();
        expect(second.result!.picks.map((pick) => [pick.symbol, pick.total])).toEqual(first.result!.picks.map((pick) => [pick.symbol, pick.total]));
        expect(second.result!.snapshotId).not.toBe(first.result!.snapshotId);
        expect(await runs()).toHaveLength(2);
    });

    it('refresh does nothing when today\'s run for the current profile exists, and builds after a profile change', async () => {
        const first = await refreshWatchlist();
        expect(first).toEqual({ started: true });
        await buildStatus().promise;
        const again = await refreshWatchlist();
        expect(again.started).toBe(false);
        expect(again).toMatchObject({ reasonCode: 'already_current' });
        expect(again.started === false && again.reason).toContain('once a day');
        expect(buildStatus().building).toBe(false);
        expect(await runs()).toHaveLength(1);

        await editProfile({ risk: 'Low' });
        expect(await refreshWatchlist()).toEqual({ started: true });
        await buildStatus().promise;
        expect(await runs()).toHaveLength(2);
    });

    it('refresh rebuilds the same day after a simulated trade changes the holdings', async () => {
        await refreshWatchlist();
        await buildStatus().promise;
        expect(await refreshWatchlist()).toMatchObject({ started: false, reasonCode: 'already_current' });

        await simulateTrade({ symbol: 'AAPL', side: 'buy', amountCad: 500, acknowledgeConflict: true });
        expect(await refreshWatchlist()).toEqual({ started: true });
        await buildStatus().promise;
        expect(await runs()).toHaveLength(2);
        expect(await refreshWatchlist()).toMatchObject({ started: false, reasonCode: 'already_current' });
    });

    it('refresh answers a reason code while a build is running', async () => {
        await refreshWatchlist();
        const during = await refreshWatchlist('fr');
        expect(during).toMatchObject({ started: false, reasonCode: 'building', reason: 'Un calcul est déjà en cours.' });
        await buildStatus().promise;
    });

    it('every refresh reason code has a translated note for the Recompute button', async () => {
        const { readFileSync } = await import('node:fs');
        const path = await import('node:path');
        for (const locale of ['en', 'fr']) {
            const list = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'messages', locale, 'Watchlist.json'), 'utf8')).list;
            for (const code of ['already_current', 'building'] satisfies Array<Extract<Awaited<ReturnType<typeof refreshWatchlist>>, { started: false }>['reasonCode']>) {
                expect(typeof list.recomputeSkipped[code]).toBe('string');
            }
        }
    });

    it('the inputs hash follows holdings and the rules-file version, not the position order', () => {
        const a = inputsHash([{ symbol: 'AAPL', quantity: 2 }, { symbol: 'RY.TO', quantity: 5 }]);
        expect(inputsHash([{ symbol: 'RY.TO', quantity: 5 }, { symbol: 'AAPL', quantity: 2 }])).toBe(a);
        expect(inputsHash([{ symbol: 'AAPL', quantity: 3 }, { symbol: 'RY.TO', quantity: 5 }])).not.toBe(a);
        expect(inputsHash([])).not.toBe(a);
        const rules = { version: 'v1', versions: { score: 'score-v1' } };
        expect(inputsHash([], rules)).not.toBe(inputsHash([], { ...rules, version: 'v2' }));
        expect(inputsHash([], rules)).not.toBe(inputsHash([], { ...rules, versions: { score: 'score-v2' } }));
    });

    it('refresh refuses before onboarding', async () => {
        await freshWorld(false);
        await expect(refreshWatchlist()).rejects.toMatchObject({ status: 409 });
    });

    it('treats the stored run as outdated after a profile edit', async () => {
        await getWatchlist();
        const before = await built();
        const { profile } = await editProfile({ risk: 'Low' });
        expect(profileHash(profile)).not.toBe(profileHash({ ...profile, risk: 'Medium' }));
        expect(profileHash(profile)).toBe(profileHash({ ...profile, answers: { ...profile.answers, agentStyle: 'teach me', goal: 'learn' } }));
        expect(profileHash(profile)).not.toBe(profileHash({ ...profile, answers: { ...profile.answers, avoid: ['Energy'] } }));
        expect(await getWatchlist()).toMatchObject({ result: null, building: true });
        const after = await built();
        expect(after.result).toMatchObject({ risk: 'Low' });
        expect(after.result!.snapshotId).not.toBe(before.result!.snapshotId);
        expect(await runs()).toHaveLength(2);
    });

    it('hides a dismissed pick from the list, keeps it in the log, and records each action', async () => {
        await getWatchlist();
        const view = await built();
        const [top, second] = view.result!.picks.map((pick) => pick.symbol);
        expect(await userAction(top.toLowerCase(), 'dismiss')).toEqual({ state: { pinned: [], dismissed: [top] } });
        expect((await userAction(second, 'pin')).state).toEqual({ pinned: [second], dismissed: [top] });

        const after = await getWatchlist();
        expect(after.result!.picks.map((pick) => pick.symbol)).not.toContain(top);
        expect(after.result!.picks).toHaveLength(8);
        expect(after.result!.picks.map((pick) => pick.symbol)).toEqual(view.result!.picks.map((pick) => pick.symbol).filter((symbol) => symbol !== top));
        expect(after.state).toEqual({ pinned: [second], dismissed: [top] });
        expect(await explainSymbol(top)).toMatchObject({ listed: true, pick: { symbol: top } });

        expect((await userAction(top, 'add')).state.dismissed).toEqual([]);
        expect((await userAction(second, 'unpin')).state.pinned).toEqual([]);
        await expect(userAction('NOPE', 'pin')).rejects.toMatchObject({ status: 404 });
        const actions = await listDecisions(DEMO_USER.id, { kind: 'user_action' });
        expect(actions.map((entry) => [entry.symbol, (entry.payload as { action: string }).action])).toEqual([[top, 'dismiss'], [second, 'pin'], [top, 'add'], [second, 'unpin']]);
        expect(actions[0].snapshotId).toBe(view.result!.snapshotId);
    });

    it('starts without incumbents when the profile changed: Medium, Low, then Medium again gives the first Medium list', async () => {
        const symbols = (view: Awaited<ReturnType<typeof getWatchlist>>) => view.result!.picks.map((pick) => pick.symbol);
        // Volatility 15%: inside the Low cap, so the Low run lists these; the Medium run keeps CCO.TO and CNQ.TO for Energy
        for (const symbol of ['COP', 'XOM', 'IVV', 'VCN.TO', 'VTI', 'XIC.TO', 'XIU.TO', 'SPY', 'VOO', 'VFV.TO']) market.signals[symbol] = { volatility1y: sourced(0.15, { source: 'derived' }) };
        await getWatchlist();
        const medium = await built();
        const mediumHash = profileHash((await getProfile(DEMO_USER.id))!);
        await editProfile({ risk: 'Low' });
        await getWatchlist();
        const low = await built();
        const lowHash = profileHash((await getProfile(DEMO_USER.id))!);
        expect(symbols(low)).not.toEqual(symbols(medium));
        expect((await readState()).watchlist).toMatchObject({ previousPicks: symbols(low), stateProfileHash: lowHash });

        await editProfile({ risk: 'Medium' });
        await getWatchlist();
        const again = await built();
        expect(symbols(again)).toEqual(symbols(medium));
        expect(again.result!.picks.map((pick) => pick.kept)).toEqual(medium.result!.picks.map((pick) => pick.kept));
        expect(again.result!.picks.some((pick) => pick.kept === 'incumbent')).toBe(false);
        const logged = (await runs()).map((run) => run.payload as { incumbentsReset?: unknown; previous?: unknown });
        expect(logged).toHaveLength(3);
        expect(logged[0].incumbentsReset).toBeUndefined();
        expect(logged[1].incumbentsReset).toEqual({ reason: 'profile_changed', fromProfileHash: mediumHash, toProfileHash: lowHash, dropped: symbols(medium) });
        expect(logged[2].incumbentsReset).toEqual({ reason: 'profile_changed', fromProfileHash: lowHash, toProfileHash: mediumHash, dropped: symbols(low) });
        expect(logged[2].previous).toEqual({ listedSince: {}, previousPicks: [] });
        expect((await readState()).watchlist).toMatchObject({ previousPicks: symbols(medium), stateProfileHash: mediumHash });
    });

    it('a same-profile run on the next day keeps the incumbents', async () => {
        await getWatchlist();
        const first = await built();
        const listedSince = (await readState()).watchlist.listedSince;
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(Date.now() + 86_400_000);
        try {
            expect(await getWatchlist()).toMatchObject({ result: null, building: true });     // a new market day
            const next = await built();
            expect(next.result!.picks.map((pick) => pick.symbol)).toEqual(first.result!.picks.map((pick) => pick.symbol));
            expect(next.result!.picks.filter((pick) => pick.kept !== 'seed').every((pick) => pick.kept === 'incumbent')).toBe(true);
        } finally {
            vi.useRealTimers();
        }
        const [, second] = await runs();
        expect(second.payload).not.toHaveProperty('incumbentsReset');
        expect((second.payload as { previous: unknown }).previous).toEqual({ listedSince, previousPicks: first.result!.picks.map((pick) => pick.symbol) });
        expect((await readState()).watchlist.listedSince).toEqual(listedSince);       // they stay, so their dates do not move
    });

    it('names the incumbents that kept a passing candidate out, with the minimum stay and the margin from the rules file', async () => {
        // MSFT and NVDA: total 46.6 (volatility 5% scores 62.5 on risk fit, growth -10% scores 0), listed 2 days ago.
        // VTI: total 50, listed 10 days ago, so past its minimum stay and held by the margin. The list fills before XIU.TO (total 50).
        const weak = { volatility1y: sourced(0.05, { source: 'derived' }), revenueGrowthPct: sourced(-10, { unit: '%' }) };
        market.signals.MSFT = weak;
        market.signals.NVDA = weak;
        const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
        await updateState((state) => {
            state.watchlist.previousPicks = ['MSFT', 'NVDA', 'VTI'];
            state.watchlist.listedSince = { MSFT: daysAgo(2), NVDA: daysAgo(2), VTI: daysAgo(10) };
        });
        await buildWatchlist();
        const view = await built();
        expect(view.result!.picks).toHaveLength(10);
        expect(view.result!.picks.map((pick) => pick.symbol)).not.toContain('XIU.TO');
        expect(view.result!.picks.filter((pick) => pick.kept === 'incumbent').map((pick) => [pick.symbol, pick.total])).toEqual([['VTI', 50], ['MSFT', 46.6], ['NVDA', 46.6]]);

        const why = await explainSymbol('XIU.TO');
        expect(why).toMatchObject({ listed: false, candidate: { symbol: 'XIU.TO', passed: true, total: 50 } });
        expect(why.note).toBe('XIU.TO passed every filter with a total of 50, and was not selected: the list was full (10 picks) and these picks with a total no higher kept their places: '
            + 'VTI (total 50) was already listed, and a newcomer takes a listed pick\'s place only with a total more than 5 points higher (the difference here is 0 points); '
            + 'MSFT (total 46.6) had been listed for 2 days, inside the 7-day minimum stay; NVDA (total 46.6) had been listed for 2 days, inside the 7-day minimum stay.');
        const fr = (await explainSymbol('XIU.TO', 'fr')).note!;
        expect(fr).toContain('la liste était complète (10 titres)');
        expect(fr).toContain('VTI (pointage total de 50) était déjà inscrit, et un nouveau venu ne remplace un titre inscrit qu’avec un pointage total supérieur de plus de 5 points (l’écart est ici de 0 point)');
        expect(fr).toContain('MSFT (pointage total de 46,6) était inscrit depuis 2 jours, à l’intérieur de la durée minimale de 7 jours');

        // An Energy candidate: the sector cap applies too, so no single rule is named and the limits are listed
        const capped = (await explainSymbol('COP')).note!;
        expect(capped).toContain('other picks ranked ahead of it');
        expect(capped).toContain('at most 2 per sector; a listed pick keeps its place for at least 7 days, and after that a newcomer takes its place only with a total more than 5 points higher');
    });

    it('gives a listed pick its filter checks under candidate.filters, in the language asked for', async () => {
        await getWatchlist();
        await built();
        const listed = await explainSymbol('AAPL', 'fr');
        expect(listed).toMatchObject({ listed: true, pick: { symbol: 'AAPL' }, candidate: { symbol: 'AAPL', passed: true } });
        expect(listed.candidate!.filters.length).toBeGreaterThan(0);
        expect(listed.candidate!.filters.every((check) => check.pass)).toBe(true);
        const english = await explainSymbol('AAPL', 'en');
        expect(listed.candidate!.filters.map((check) => check.filter)).toEqual(english.candidate!.filters.map((check) => check.filter));
        expect(listed.candidate!.filters.map((check) => check.detail)).not.toEqual(english.candidate!.filters.map((check) => check.detail));
    });

    it('explains a pick, a rejected candidate, and a symbol outside the candidates', async () => {
        await expect(explainSymbol('AAPL')).rejects.toMatchObject({ status: 404 });
        await getWatchlist();
        const view = await built();
        const [run] = await runs();

        const listed = await explainSymbol('aapl');
        expect(listed).toMatchObject({ listed: true, pick: { symbol: 'AAPL' }, snapshotId: view.result!.snapshotId, computedAt: view.result!.computedAt, ruleVersions: run.ruleVersions });
        expect(listed.decisionIds).toHaveLength(2);
        expect(listed.decisionIds[0]).toBe(run.id);

        const crypto = await explainSymbol('BTC');
        expect(crypto.listed).toBe(false);
        expect(crypto.rejected).toEqual([expect.objectContaining({ filter: 'crypto_risk', pass: false })]);

        const outside = await explainSymbol('JPM');
        expect(outside).toMatchObject({ listed: false, decisionIds: [run.id] });
        expect(outside.note).toContain('not among the');
    });
});
