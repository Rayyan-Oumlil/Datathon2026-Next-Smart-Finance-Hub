// The smart watchlist as a service: build a run (in the background, a cold signal cache can take minutes), log it
// whole to the decision log, and serve the day's run from that log. The ranking itself is lib/watchlist.

import { createHash, randomBytes } from 'node:crypto';
import { DEMO_USER } from '@/lib/demo-user';
import type { Candidate, DecisionLogEntry, FilterCheck, Pick as WatchlistPick, ProfileConfig, SignalSet, Snapshot, Sourced, WatchlistResult } from '@/lib/domain/types';
import { RULES, RULE_VERSIONS } from '@/lib/rules';
import { loadDailySignals, marketDate, refreshDailySignals } from '@/lib/sources/daily-signals';
import { appendDecision, getDecision, getProfile, readState, updateState, type AppState } from '@/lib/store';
import { getEntry, getUniverse } from '@/lib/universe';
import { runPipeline } from '@/lib/watchlist/pipeline';
import { selectCandidates } from '@/lib/watchlist/universe-select';
import { ServiceError } from './errors';
import { holdingsSummary } from './portfolio';

export type WatchlistAction = 'add' | 'dismiss' | 'pin' | 'unpin';
export type BuildProgress = { startedAt: string; stage: 'signals' | 'ranking' | 'logging'; done: number; total: number; symbol?: string };

type RunCandidate = Omit<Candidate, 'signals'>;     // the signals are in the snapshot, not stored twice
type RunPayload = {
    date: string;                 // the market day this run is for
    profileHash: string;          // of the level, risk and answers the run used
    signalsDate: string;
    signalsStale: boolean;
    seeds: string[];
    snapshot: Snapshot;
    candidates: RunCandidate[];
    result: WatchlistResult;
    pickDecisionIds: Record<string, string>;
};
// Where the last run sits in the decision log. Kept beside the watchlist state in the app-state file, which
// has no field for it in its type; the file keeps unknown keys.
type RunPointer = { date: string; profileHash: string; decisionId: string };
type StoredWatchlist = AppState['watchlist'] & { lastRun?: RunPointer };

export type WatchlistView = {
    result: WatchlistResult | null;
    state: { pinned: string[]; dismissed: string[] };
    signalsDate: string | null;
    stale: boolean;
    building: boolean;
    progress: BuildProgress | null;
    needsProfile?: true;
    error?: string;
};

const RETRY_AFTER_FAILURE_MS = 60_000;
const holder = globalThis as {
    __watchlistBuild?: { promise: Promise<void>; progress: BuildProgress } | null;
    __watchlistRun?: DecisionLogEntry | null;
    __watchlistFailure?: { at: number; profileHash: string; message: string } | null;
};

/**
 * Changes whenever an input the pipeline reads from the profile changes; a stored run with another hash is
 * outdated. Answers the pipeline never reads (goal, agent style ...) are left out, so editing them keeps the run.
 */
export function profileHash(profile: Pick<ProfileConfig, 'level' | 'risk' | 'answers'>): string {
    const { markets, sectors, niches, themes, brands, avoid } = profile.answers;
    const inputs = [profile.level, profile.risk, markets, sectors, niches, themes, brands, avoid];
    return createHash('sha256').update(JSON.stringify(inputs)).digest('hex').slice(0, 16);
}

/** Every distinct source behind a pick's signals, with the fetch time of each. */
function sourcesOf(signals: SignalSet): Array<{ signal: string; source: string; fetchedAt: string; asOf?: string }> {
    return Object.entries(signals)
        .filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value) && 'source' in value && 'fetchedAt' in value)
        .map(([signal, value]) => {
            const { source, fetchedAt, asOf } = value as Sourced<unknown>;
            return { signal, source, fetchedAt, ...(asOf ? { asOf } : {}) };
        });
}

async function lastRun(): Promise<DecisionLogEntry | null> {
    const pointer = ((await readState()).watchlist as StoredWatchlist).lastRun;
    if (!pointer) return null;
    if (holder.__watchlistRun?.id === pointer.decisionId) return holder.__watchlistRun;
    const entry = await getDecision(DEMO_USER.id, pointer.decisionId);
    holder.__watchlistRun = entry;
    return entry;
}

async function build(profile: ProfileConfig, progress: BuildProgress): Promise<void> {
    const universe = getUniverse();
    const { candidates: entries, seeds } = selectCandidates(universe, profile);
    progress.total = entries.length;
    const onProgress = (done: number, total: number, symbol: string) => Object.assign(progress, { done, total, symbol });

    // The day's signals are collected once: a second run on the same day reads the same file
    let daily = await loadDailySignals(entries, { onProgress });
    if (daily.stale) daily = await refreshDailySignals(entries, { onProgress }).catch(() => daily);

    progress.stage = 'ranking';
    const now = new Date().toISOString();
    const date = marketDate(new Date(now));
    const snapshot: Snapshot = {
        id: `snap_${date}_${randomBytes(4).toString('hex')}`,
        takenAt: now,
        userId: DEMO_USER.id,
        profile: { level: profile.level, risk: profile.risk, answers: profile.answers, ruleVersions: profile.ruleVersions },
        holdings: await holdingsSummary(),
        fxUsdCad: daily.fxUsdCad,
        signals: daily.signals,
    };
    const { listedSince, previousPicks } = (await readState()).watchlist;
    const { result, candidates, next } = runPipeline({ snapshot, universe, rules: RULES, previous: { listedSince, previousPicks }, now });

    progress.stage = 'logging';
    const ruleVersions = { ...result.ruleVersions, level: profile.ruleVersions.level, risk: profile.ruleVersions.risk };
    const pickDecisionIds: Record<string, string> = {};
    for (const pick of result.picks) {
        const logged = await appendDecision({
            userId: DEMO_USER.id,
            kind: 'pick',
            symbol: pick.symbol,
            snapshotId: snapshot.id,
            ruleVersions,
            payload: { rank: pick.rank, name: pick.name, total: pick.total, factors: pick.factors, topDrivers: pick.topDrivers, kept: pick.kept, reason: pick.reason, sources: sourcesOf(pick.signals) },
        });
        pickDecisionIds[pick.symbol] = logged.id;
    }
    const payload: RunPayload = {
        date,
        profileHash: profileHash(profile),
        signalsDate: daily.date,
        signalsStale: daily.stale,
        seeds,
        snapshot,
        candidates: candidates.map(({ symbol, filters, passed, factors, total }) => ({ symbol, filters, passed, factors, total })),
        result,
        pickDecisionIds,
    };
    const run = await appendDecision({ userId: DEMO_USER.id, kind: 'watchlist_run', snapshotId: snapshot.id, ruleVersions, payload });
    await updateState((state) => {
        const watchlist = state.watchlist as StoredWatchlist;
        watchlist.listedSince = next.listedSince;
        watchlist.previousPicks = next.previousPicks;
        watchlist.lastRun = { date, profileHash: payload.profileHash, decisionId: run.id };
    });
    holder.__watchlistRun = run;
}

/**
 * Starts a run unless one is in progress, and returns at once: the caller polls getWatchlist. The promise is
 * returned for tests and scripts that want to wait.
 */
export async function buildWatchlist(): Promise<{ started: boolean; done: Promise<void> }> {
    if (holder.__watchlistBuild) return { started: false, done: holder.__watchlistBuild.promise };
    const profile = await getProfile(DEMO_USER.id);
    if (!profile) throw new ServiceError(409, 'No profile exists yet. Complete onboarding first.');
    // Another request may have started one while the profile was read
    const raced = buildStatus().promise;
    if (raced) return { started: false, done: raced };

    const progress: BuildProgress = { startedAt: new Date().toISOString(), stage: 'signals', done: 0, total: 0 };
    const hash = profileHash(profile);
    const promise = build(profile, progress)
        .then(() => {
            holder.__watchlistFailure = null;
        })
        .catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            console.error('watchlist build failed:', message);
            holder.__watchlistFailure = { at: Date.now(), profileHash: hash, message: 'The watchlist could not be computed. Try again in a minute.' };
        })
        .finally(() => {
            holder.__watchlistBuild = null;
        });
    holder.__watchlistBuild = { promise, progress };
    return { started: true, done: promise };
}

/** Today's run for the current profile, from the decision log. When there is none, a build is started. */
export async function getWatchlist(): Promise<WatchlistView> {
    const [profile, state] = await Promise.all([getProfile(DEMO_USER.id), readState()]);
    const { pinned, dismissed } = state.watchlist;
    const view: WatchlistView = { result: null, state: { pinned, dismissed }, signalsDate: null, stale: false, building: Boolean(holder.__watchlistBuild), progress: holder.__watchlistBuild?.progress ?? null };
    if (!profile) return { ...view, needsProfile: true };

    const hash = profileHash(profile);
    const pointer = (state.watchlist as StoredWatchlist).lastRun;
    if (pointer && pointer.date === marketDate() && pointer.profileHash === hash) {
        const payload = (await lastRun())?.payload as RunPayload | undefined;
        if (payload) {
            // Dismissed symbols are hidden here; they stay in the logged run
            const hidden = new Set(dismissed);
            const result = { ...payload.result, picks: payload.result.picks.filter((pick) => !hidden.has(pick.symbol)) };
            return { ...view, result, signalsDate: payload.signalsDate, stale: payload.signalsStale };
        }
    }
    if (view.building) return view;
    const failure = holder.__watchlistFailure;
    if (failure && failure.profileHash === hash && Date.now() - failure.at < RETRY_AFTER_FAILURE_MS) return { ...view, error: failure.message };
    await buildWatchlist();
    return { ...view, building: true, progress: holder.__watchlistBuild?.progress ?? null };
}

export type Explanation = {
    listed: boolean;
    pick?: WatchlistPick;
    rejected?: FilterCheck[];
    candidate?: RunCandidate;     // passed the filters but was not selected: its checks and scores
    note?: string;
    snapshotId: string;
    computedAt: string;
    ruleVersions: Record<string, string>;
    decisionIds: string[];
};

/** The "Why?" panel: what the last logged run says about one symbol. */
export async function explainSymbol(symbol: string): Promise<Explanation> {
    const run = await lastRun();
    if (!run) throw new ServiceError(404, 'No watchlist has been computed yet.');
    const payload = run.payload as RunPayload;
    const wanted = getEntry(symbol)?.symbol ?? symbol.trim().toUpperCase();
    const base = { snapshotId: payload.snapshot.id, computedAt: payload.result.computedAt, ruleVersions: run.ruleVersions ?? payload.result.ruleVersions };

    const pick = payload.result.picks.find((p) => p.symbol === wanted);
    if (pick) return { listed: true, pick, ...base, decisionIds: [run.id, payload.pickDecisionIds[wanted]].filter(Boolean) };

    const candidate = payload.candidates.find((c) => c.symbol === wanted);
    if (!candidate) return { listed: false, note: `${wanted} was not among the ${payload.candidates.length} candidates of this run: it is outside the markets, sectors, niches, themes and brands of the profile.`, ...base, decisionIds: [run.id] };
    if (!candidate.passed) return { listed: false, rejected: candidate.filters.filter((check) => !check.pass), candidate, ...base, decisionIds: [run.id] };
    const reference = candidate.total === undefined;
    return {
        listed: false,
        candidate,
        note: reference
            ? `${wanted} is shown as a reference card and is not ranked.`
            : `${wanted} passed every filter with a total of ${candidate.total}, and was not selected: the list holds ${payload.result.picks.length} picks (${payload.result.level}), at most ${RULES.selection.max_per_sector} per sector.`,
        ...base,
        decisionIds: [run.id],
    };
}

/** Records what the user did with a card. 'add' brings a dismissed symbol back. */
export async function userAction(symbol: string, action: WatchlistAction): Promise<{ state: { pinned: string[]; dismissed: string[] } }> {
    const wanted = getEntry(symbol)?.symbol;
    if (!wanted) throw new ServiceError(404, `${symbol} is not in the app's list of assets.`);
    const without = (list: string[]) => list.filter((s) => s !== wanted);
    const next = await updateState((state) => {
        const { watchlist } = state;
        if (action === 'dismiss') {
            watchlist.dismissed = [...without(watchlist.dismissed), wanted];
            watchlist.pinned = without(watchlist.pinned);
        } else if (action === 'pin') {
            watchlist.pinned = [...without(watchlist.pinned), wanted];
            watchlist.dismissed = without(watchlist.dismissed);
        } else if (action === 'unpin') {
            watchlist.pinned = without(watchlist.pinned);
        } else {
            watchlist.dismissed = without(watchlist.dismissed);
        }
    });
    const state = { pinned: next.watchlist.pinned, dismissed: next.watchlist.dismissed };
    await appendDecision({
        userId: DEMO_USER.id,
        kind: 'user_action',
        symbol: wanted,
        snapshotId: (await lastRun())?.snapshotId,
        ruleVersions: RULE_VERSIONS,
        payload: { action, state },
    });
    return { state };
}

export function buildStatus(): { building: boolean; progress: BuildProgress | null; promise: Promise<void> | null } {
    const current = holder.__watchlistBuild;
    return { building: Boolean(current), progress: current?.progress ?? null, promise: current?.promise ?? null };
}

/** Test helper: forgets the run held in memory and any build state. */
export function resetWatchlistMemory(): void {
    holder.__watchlistBuild = null;
    holder.__watchlistRun = null;
    holder.__watchlistFailure = null;
}
