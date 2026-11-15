// The smart watchlist as a service: build a run (in the background, a cold signal cache can take minutes), log it
// whole to the decision log, and serve the day's run from that log. The ranking itself is lib/watchlist.

import { createHash, randomBytes } from 'node:crypto';
import { getAppLocale } from '@/i18n/locale';
import { DEMO_USER } from '@/lib/demo-user';
import type { Candidate, DecisionLogEntry, FilterCheck, Pick as WatchlistPick, ProfileConfig, SignalSet, Snapshot, Sourced, WatchlistResult } from '@/lib/domain/types';
import { RULES, RULES_VERSION, RULE_VERSIONS } from '@/lib/rules';
import { loadDailySignals, marketDate, refreshDailySignals } from '@/lib/sources/daily-signals';
import { appendDecision, getDecision, getProfile, readState, updateState, type AppState } from '@/lib/store';
import { getEntry, getUniverse } from '@/lib/universe';
import { runPipeline } from '@/lib/watchlist/pipeline';
import { renderCandidate, renderPick, renderRun, renderChecks } from '@/lib/watchlist/render';
import type { Locale } from '@/lib/watchlist/text';
import { selectCandidates } from '@/lib/watchlist/universe-select';
import { ServiceError } from './errors';
import { renderText, serviceRef } from './text';
import { getPortfolioState, holdingsWithDetail, type HoldingDetail } from './portfolio';

export type WatchlistAction = 'add' | 'dismiss' | 'pin' | 'unpin';
export type BuildProgress = { startedAt: string; stage: 'signals' | 'ranking' | 'logging'; done: number; total: number; symbol?: string };

type RunCandidate = Omit<Candidate, 'signals'>;     // the signals are in the snapshot, not stored twice
type RunPayload = {
    date: string;                 // the market day this run is for
    profileHash: string;          // of the level, risk and answers the run used
    inputsHash?: string;          // of the holdings (symbol, quantity) and rules-file versions the run used
    signalsDate: string;
    signalsStale: boolean;
    seeds: string[];
    snapshot: Snapshot;
    holdingsDetail: HoldingDetail[];  // how each position in snapshot.holdings was valued (last price or cost)
    candidates: RunCandidate[];
    result: WatchlistResult;
    pickDecisionIds: Record<string, string>;
    locale?: Locale;              // the language the run's sentences were written in (result.locale says the same)
};
// Where the last run sits in the decision log. Kept beside the watchlist state in the app-state file, which
// has no field for it in its type; the file keeps unknown keys.
type RunPointer = { date: string; profileHash: string; inputsHash?: string; decisionId: string };
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
    __watchlistFailure?: { at: number; profileHash: string } | null;
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

/**
 * Changes whenever the holdings (symbol and quantity) or the rules-file versions change. The diversification
 * factor reads the holdings, so a simulated trade or a rules change on the same day makes Recompute rebuild.
 */
export function inputsHash(positions: Array<{ symbol: string; quantity: number }>, rules: { version: string; versions: Record<string, string> } = { version: RULES_VERSION, versions: RULE_VERSIONS }): string {
    const holdings = positions.map(({ symbol, quantity }) => [symbol, quantity] as const).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return createHash('sha256').update(JSON.stringify([holdings, rules.version, rules.versions])).digest('hex').slice(0, 16);
}

const currentInputsHash = async (): Promise<string> => inputsHash((await getPortfolioState()).positions);

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

async function build(profile: ProfileConfig, progress: BuildProgress, locale: Locale): Promise<void> {
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
    const [holdings, inputs] = await Promise.all([holdingsWithDetail(), currentInputsHash()]);
    const snapshot: Snapshot = {
        id: `snap_${date}_${randomBytes(4).toString('hex')}`,
        takenAt: now,
        userId: DEMO_USER.id,
        profile: { level: profile.level, risk: profile.risk, answers: profile.answers, ruleVersions: profile.ruleVersions },
        holdings: holdings.summary,
        fxUsdCad: daily.fxUsdCad,
        signals: daily.signals,
    };
    const { listedSince, previousPicks } = (await readState()).watchlist;
    const { result, candidates, next } = runPipeline({ snapshot, universe, rules: RULES, previous: { listedSince, previousPicks }, now, locale });

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
        inputsHash: inputs,
        signalsDate: daily.date,
        signalsStale: daily.stale,
        seeds,
        snapshot,
        holdingsDetail: holdings.detail,
        candidates: candidates.map(({ symbol, filters, passed, factors, total }) => ({ symbol, filters, passed, factors, total })),
        result,
        pickDecisionIds,
        locale,
    };
    const run = await appendDecision({ userId: DEMO_USER.id, kind: 'watchlist_run', snapshotId: snapshot.id, ruleVersions, payload });
    await updateState((state) => {
        const watchlist = state.watchlist as StoredWatchlist;
        watchlist.listedSince = next.listedSince;
        watchlist.previousPicks = next.previousPicks;
        watchlist.lastRun = { date, profileHash: payload.profileHash, inputsHash: inputs, decisionId: run.id };
    });
    holder.__watchlistRun = run;
}

/** The language a service writes in: the one given, else the current request's (English outside a request). */
const languageOf = async (locale?: Locale): Promise<Locale> => locale ?? getAppLocale();

/**
 * Starts a run unless one is in progress, and returns at once: the caller polls getWatchlist. The promise is
 * returned for tests and scripts that want to wait. The run is written in `locale` (default: the request's
 * language) and records it; any reader can render it again in the other language (renderRun).
 */
export async function buildWatchlist(locale?: Locale): Promise<{ started: boolean; done: Promise<void> }> {
    if (holder.__watchlistBuild) return { started: false, done: holder.__watchlistBuild.promise };
    const lang = await languageOf(locale);
    const profile = await getProfile(DEMO_USER.id);
    if (!profile) throw new ServiceError(409, serviceRef('svc.no_profile', {}));
    // Another request may have started one while the profile was read
    const raced = buildStatus().promise;
    if (raced) return { started: false, done: raced };

    const progress: BuildProgress = { startedAt: new Date().toISOString(), stage: 'signals', done: 0, total: 0 };
    const hash = profileHash(profile);
    const promise = build(profile, progress, lang)
        .then(() => {
            holder.__watchlistFailure = null;
        })
        .catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            console.error('watchlist build failed:', message);
            holder.__watchlistFailure = { at: Date.now(), profileHash: hash };
        })
        .finally(() => {
            holder.__watchlistBuild = null;
        });
    holder.__watchlistBuild = { promise, progress };
    return { started: true, done: promise };
}

/** Why a refresh started nothing: the UI translates the code; `reason` is the same in the request's language. */
export type RefreshSkipCode = 'already_current' | 'building';
export type RefreshResult = { started: true } | { started: false; reasonCode: RefreshSkipCode; reason: string };

/**
 * The refresh request: the list is recomputed once a day (selection.slow_moving.recompute). Nothing is started
 * when a logged run already holds today's signals for the current profile, holdings and rules file; a profile
 * change, a simulated trade, a rules change or a missing run (or a run on an earlier day's signals) starts a build.
 * The reason is written in `locale` (default: the request's), with a code the UI can translate itself.
 */
export async function refreshWatchlist(locale?: Locale): Promise<RefreshResult> {
    const lang = await languageOf(locale);
    const profile = await getProfile(DEMO_USER.id);
    if (!profile) throw new ServiceError(409, serviceRef('svc.no_profile', {}));
    const today = marketDate();
    const pointer = ((await readState()).watchlist as StoredWatchlist).lastRun;
    if (pointer && pointer.date === today && pointer.profileHash === profileHash(profile) && pointer.inputsHash === (await currentInputsHash())) {
        const payload = (await lastRun())?.payload as RunPayload | undefined;
        if (payload && payload.signalsDate === today) {
            return { started: false, reasonCode: 'already_current', reason: renderText(serviceRef('svc.watchlist.already_today', { date: today }), lang) };
        }
    }
    const { started } = await buildWatchlist(lang);
    return started ? { started } : { started, reasonCode: 'building', reason: renderText(serviceRef('svc.watchlist.in_progress', {}), lang) };
}

/**
 * Today's run for the current profile, from the decision log. When there is none, a build is started.
 * Every sentence is in `locale` (default: the request's language), whatever language the run was computed in.
 */
export async function getWatchlist(locale?: Locale): Promise<WatchlistView> {
    const lang = await languageOf(locale);
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
            const result = renderRun({ ...payload.result, picks: payload.result.picks.filter((pick) => !hidden.has(pick.symbol)) }, lang);
            return { ...view, result, signalsDate: payload.signalsDate, stale: payload.signalsStale };
        }
    }
    if (view.building) return view;
    const failure = holder.__watchlistFailure;
    if (failure && failure.profileHash === hash && Date.now() - failure.at < RETRY_AFTER_FAILURE_MS) {
        return { ...view, error: renderText(serviceRef('svc.watchlist.failed', {}), lang) };
    }
    await buildWatchlist(lang);
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

/**
 * The "Why?" panel: what the last logged run says about one symbol. Every sentence (filter checks, factor details,
 * reason, note) is in `locale` (default: the request's language), whatever language the run was computed in.
 */
export async function explainSymbol(symbol: string, locale?: Locale): Promise<Explanation> {
    const lang = await languageOf(locale);
    const run = await lastRun();
    if (!run) throw new ServiceError(404, serviceRef('svc.watchlist.no_run', {}));
    const payload = run.payload as RunPayload;
    const wanted = getEntry(symbol)?.symbol ?? symbol.trim().toUpperCase();
    const base = { snapshotId: payload.snapshot.id, computedAt: payload.result.computedAt, ruleVersions: run.ruleVersions ?? payload.result.ruleVersions };

    const say = (ref: Parameters<typeof renderText>[0]) => renderText(ref, lang);

    const pick = payload.result.picks.find((p) => p.symbol === wanted);
    if (pick) return { listed: true, pick: renderPick(pick, lang), ...base, decisionIds: [run.id, payload.pickDecisionIds[wanted]].filter(Boolean) };

    const stored = payload.candidates.find((c) => c.symbol === wanted);
    if (!stored) return { listed: false, note: say(serviceRef('svc.watchlist.not_candidate', { symbol: wanted, count: payload.candidates.length })), ...base, decisionIds: [run.id] };
    const candidate = renderCandidate(stored, lang);
    if (!candidate.passed) return { listed: false, rejected: renderChecks(stored.filters.filter((check) => !check.pass), lang), candidate, ...base, decisionIds: [run.id] };
    const reference = candidate.total === undefined;
    return {
        listed: false,
        candidate,
        note: reference
            ? say(serviceRef('svc.watchlist.reference_card', { symbol: wanted }))
            : say(serviceRef('svc.watchlist.not_selected', { symbol: wanted, total: candidate.total!, picks: payload.result.picks.length, level: payload.result.level, maxPerSector: RULES.selection.max_per_sector })),
        ...base,
        decisionIds: [run.id],
    };
}

/** Records what the user did with a card. 'add' brings a dismissed symbol back. */
export async function userAction(symbol: string, action: WatchlistAction): Promise<{ state: { pinned: string[]; dismissed: string[] } }> {
    const wanted = getEntry(symbol)?.symbol;
    if (!wanted) throw new ServiceError(404, serviceRef('svc.not_in_universe', { symbol }));
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
