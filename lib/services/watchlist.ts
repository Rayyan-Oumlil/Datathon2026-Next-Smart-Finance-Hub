// The smart watchlist as a service: build a run (in the background, a cold signal cache can take minutes), log it
// whole to the decision log, and serve the day's run from that log. The ranking itself is lib/watchlist.

import { createHash, randomBytes } from 'node:crypto';
import { getAppLocale } from '@/i18n/locale';
import type { Candidate, DecisionLogEntry, TextRef, FilterCheck, Pick as WatchlistPick, ProfileConfig, SignalSet, Snapshot, Sourced, WatchlistResult } from '@/lib/domain/types';
import { RULES, RULES_VERSION, RULE_VERSIONS } from '@/lib/rules';
import { loadDailySignals, marketDate, refreshDailySignals } from '@/lib/sources/daily-signals';
import { currentScope, type Scope } from '@/lib/session';
import { appendDecision, getDecision, getProfile, readState, updateState, type AppState } from '@/lib/store';
import { getEntry, getUniverse } from '@/lib/universe';
import { own } from '@/lib/watchlist/format';
import { runPipeline } from '@/lib/watchlist/pipeline';
import { renderCandidate, renderPick, renderRun, renderChecks } from '@/lib/watchlist/render';
import type { Locale } from '@/lib/watchlist/text';
import type { PreviousList } from '@/lib/watchlist/selection';
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
    previous?: PreviousList;      // the slow-moving state the selection started from (empty after a reset)
    incumbentsReset?: IncumbentsReset;
};
// The slow-moving state (previousPicks, listedSince) belongs to the profile whose run wrote it. A run for another
// profile starts without incumbents: the rule keeps a list steady from day to day, it does not carry one profile's
// picks into another's. Seeds still apply.
type IncumbentsReset = { reason: 'profile_changed'; fromProfileHash: string; toProfileHash: string; dropped: string[] };
// Where the last run sits in the decision log. Kept beside the watchlist state in the app-state document, which
// has no field for it in its type; the document keeps unknown keys.
type RunPointer = { date: string; profileHash: string; inputsHash?: string; decisionId: string };
type StoredWatchlist = AppState['watchlist'] & { lastRun?: RunPointer; stateProfileHash?: string };

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
type Build = { promise: Promise<void>; progress: BuildProgress };
// One entry per scope (session generation): a visitor's build, last run and failure are never another's.
// The watchlist runs, its pointer and its state all belong to the scope id, which reads the profile and the holdings.
const holder = globalThis as {
    __watchlistBuilds?: Map<string, Build>;
    __watchlistRuns?: Map<string, DecisionLogEntry>;
    __watchlistFailures?: Map<string, { at: number; profileHash: string }>;
};
const builds = () => (holder.__watchlistBuilds ??= new Map());
const runs = () => (holder.__watchlistRuns ??= new Map());
const failures = () => (holder.__watchlistFailures ??= new Map());
// The run cache holds a whole snapshot per visitor; the oldest are forgotten and read again from the log
const MAX_CACHED_RUNS = 200;
const scopeOr = async (scope?: Scope): Promise<Scope> => scope ?? currentScope();

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

const currentInputsHash = async (scope: Scope): Promise<string> => inputsHash((await getPortfolioState(scope)).positions);

/** Every distinct source behind a pick's signals, with the fetch time of each. */
function sourcesOf(signals: SignalSet): Array<{ signal: string; source: string; fetchedAt: string; asOf?: string }> {
    return Object.entries(signals)
        .filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value) && 'source' in value && 'fetchedAt' in value)
        .map(([signal, value]) => {
            const { source, fetchedAt, asOf } = value as Sourced<unknown>;
            return { signal, source, fetchedAt, ...(asOf ? { asOf } : {}) };
        });
}

function remember(scope: Scope, run: DecisionLogEntry): void {
    const cache = runs();
    cache.delete(scope.scopeId);
    if (cache.size >= MAX_CACHED_RUNS) cache.delete(cache.keys().next().value as string);
    cache.set(scope.scopeId, run);
}

async function lastRun(scope: Scope): Promise<DecisionLogEntry | null> {
    const pointer = ((await readState(scope)).watchlist as StoredWatchlist).lastRun;
    if (!pointer) return null;
    const cached = runs().get(scope.scopeId);
    if (cached?.id === pointer.decisionId) return cached;
    const entry = await getDecision(scope.scopeId, pointer.decisionId);
    if (entry) remember(scope, entry);
    return entry;
}

async function build(scope: Scope, profile: ProfileConfig, progress: BuildProgress, locale: Locale): Promise<void> {
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
    const [holdings, inputs] = await Promise.all([holdingsWithDetail(scope), currentInputsHash(scope)]);
    const snapshot: Snapshot = {
        id: `snap_${date}_${randomBytes(4).toString('hex')}`,
        takenAt: now,
        userId: scope.scopeId,
        profile: { level: profile.level, risk: profile.risk, answers: profile.answers, ruleVersions: profile.ruleVersions },
        holdings: holdings.summary,
        fxUsdCad: daily.fxUsdCad,
        signals: daily.signals,
    };
    const hash = profileHash(profile);
    const stored = (await readState(scope)).watchlist as StoredWatchlist;
    // State written before the owner was stored belongs to the profile of the last run
    const owner = stored.stateProfileHash ?? stored.lastRun?.profileHash;
    const reset: IncumbentsReset | undefined = owner !== undefined && owner !== hash
        ? { reason: 'profile_changed', fromProfileHash: owner, toProfileHash: hash, dropped: [...stored.previousPicks] }
        : undefined;
    const previous: PreviousList = reset ? { listedSince: {}, previousPicks: [] } : { listedSince: stored.listedSince, previousPicks: stored.previousPicks };
    const { result, candidates, next } = runPipeline({ snapshot, universe, rules: RULES, previous, now, locale });

    progress.stage = 'logging';
    const ruleVersions = { ...result.ruleVersions, level: profile.ruleVersions.level, risk: profile.ruleVersions.risk };
    const pickDecisionIds: Record<string, string> = {};
    for (const pick of result.picks) {
        const logged = await appendDecision({
            userId: scope.scopeId,
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
        profileHash: hash,
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
        previous,
        ...(reset ? { incumbentsReset: reset } : {}),
    };
    const run = await appendDecision({ userId: scope.scopeId, kind: 'watchlist_run', snapshotId: snapshot.id, ruleVersions, payload });
    await updateState(scope, (state) => {
        const watchlist = state.watchlist as StoredWatchlist;
        watchlist.listedSince = next.listedSince;
        watchlist.previousPicks = next.previousPicks;
        watchlist.stateProfileHash = hash;
        watchlist.lastRun = { date, profileHash: payload.profileHash, inputsHash: inputs, decisionId: run.id };
    });
    remember(scope, run);
}

/** The language a service writes in: the one given, else the current request's (English outside a request). */
const languageOf = async (locale?: Locale): Promise<Locale> => locale ?? getAppLocale();

/**
 * Starts a run unless one is in progress, and returns at once: the caller polls getWatchlist. The promise is
 * returned for tests and scripts that want to wait. The run is written in `locale` (default: the request's
 * language) and records it; any reader can render it again in the other language (renderRun).
 */
export async function buildWatchlist(locale?: Locale, scope?: Scope): Promise<{ started: boolean; done: Promise<void> }> {
    const s = await scopeOr(scope);
    const running = builds().get(s.scopeId);
    if (running) return { started: false, done: running.promise };
    const lang = await languageOf(locale);
    const profile = await getProfile(s.profileUserId);
    if (!profile) throw new ServiceError(409, serviceRef('svc.no_profile', {}));
    // Another request may have started one while the profile was read
    const raced = builds().get(s.scopeId);
    if (raced) return { started: false, done: raced.promise };

    const progress: BuildProgress = { startedAt: new Date().toISOString(), stage: 'signals', done: 0, total: 0 };
    const hash = profileHash(profile);
    const promise = build(s, profile, progress, lang)
        .then(() => {
            failures().delete(s.scopeId);
        })
        .catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            console.error('watchlist build failed:', message);
            failures().set(s.scopeId, { at: Date.now(), profileHash: hash });
        })
        .finally(() => {
            builds().delete(s.scopeId);
        });
    builds().set(s.scopeId, { promise, progress });
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
export async function refreshWatchlist(locale?: Locale, scope?: Scope): Promise<RefreshResult> {
    const s = await scopeOr(scope);
    const lang = await languageOf(locale);
    const profile = await getProfile(s.profileUserId);
    if (!profile) throw new ServiceError(409, serviceRef('svc.no_profile', {}));
    const today = marketDate();
    const pointer = ((await readState(s)).watchlist as StoredWatchlist).lastRun;
    if (pointer && pointer.date === today && pointer.profileHash === profileHash(profile) && pointer.inputsHash === (await currentInputsHash(s))) {
        const payload = (await lastRun(s))?.payload as RunPayload | undefined;
        if (payload && payload.signalsDate === today) {
            return { started: false, reasonCode: 'already_current', reason: renderText(serviceRef('svc.watchlist.already_today', { date: today }), lang) };
        }
    }
    const { started } = await buildWatchlist(lang, s);
    return started ? { started } : { started, reasonCode: 'building', reason: renderText(serviceRef('svc.watchlist.in_progress', {}), lang) };
}

/**
 * Today's run for the current profile, from the decision log. When there is none, a build is started.
 * Every sentence is in `locale` (default: the request's language), whatever language the run was computed in.
 */
export async function getWatchlist(locale?: Locale, scope?: Scope): Promise<WatchlistView> {
    const s = await scopeOr(scope);
    const lang = await languageOf(locale);
    const [profile, state] = await Promise.all([getProfile(s.profileUserId), readState(s)]);
    const { pinned, dismissed } = state.watchlist;
    const running = builds().get(s.scopeId);
    const view: WatchlistView = { result: null, state: { pinned, dismissed }, signalsDate: null, stale: false, building: Boolean(running), progress: running?.progress ?? null };
    if (!profile) return { ...view, needsProfile: true };

    const hash = profileHash(profile);
    const pointer = (state.watchlist as StoredWatchlist).lastRun;
    if (pointer && pointer.date === marketDate() && pointer.profileHash === hash) {
        const payload = (await lastRun(s))?.payload as RunPayload | undefined;
        if (payload) {
            // Dismissed symbols are hidden here; they stay in the logged run
            const hidden = new Set(dismissed);
            const result = renderRun({ ...payload.result, picks: payload.result.picks.filter((pick) => !hidden.has(pick.symbol)) }, lang);
            return { ...view, result, signalsDate: payload.signalsDate, stale: payload.signalsStale };
        }
    }
    if (view.building) return view;
    const failure = failures().get(s.scopeId);
    if (failure && failure.profileHash === hash && Date.now() - failure.at < RETRY_AFTER_FAILURE_MS) {
        return { ...view, error: renderText(serviceRef('svc.watchlist.failed', {}), lang) };
    }
    await buildWatchlist(lang, s);
    return { ...view, building: true, progress: builds().get(s.scopeId)?.progress ?? null };
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
export async function explainSymbol(symbol: string, locale?: Locale, scope?: Scope): Promise<Explanation> {
    const lang = await languageOf(locale);
    const run = await lastRun(await scopeOr(scope));
    if (!run) throw new ServiceError(404, serviceRef('svc.watchlist.no_run', {}));
    const payload = run.payload as RunPayload;
    const wanted = getEntry(symbol)?.symbol ?? symbol.trim().toUpperCase();
    const base = { snapshotId: payload.snapshot.id, computedAt: payload.result.computedAt, ruleVersions: run.ruleVersions ?? payload.result.ruleVersions };

    const say = (ref: Parameters<typeof renderText>[0]) => renderText(ref, lang);

    const stored = payload.candidates.find((c) => c.symbol === wanted);
    const pick = payload.result.picks.find((p) => p.symbol === wanted);
    // A pick comes with its filter checks too, under candidate.filters as for a symbol that was not selected
    if (pick) return { listed: true, pick: renderPick(pick, lang), ...(stored ? { candidate: renderCandidate(stored, lang) } : {}), ...base, decisionIds: [run.id, payload.pickDecisionIds[wanted]].filter(Boolean) };

    if (!stored) return { listed: false, note: say(serviceRef('svc.watchlist.not_candidate', { symbol: wanted, count: payload.candidates.length })), ...base, decisionIds: [run.id] };
    const candidate = renderCandidate(stored, lang);
    if (!candidate.passed) return { listed: false, rejected: renderChecks(stored.filters.filter((check) => !check.pass), lang), candidate, ...base, decisionIds: [run.id] };
    const reference = candidate.total === undefined;
    return {
        listed: false,
        candidate,
        note: reference
            ? say(serviceRef('svc.watchlist.reference_card', { symbol: wanted }))
            : say(whyNotSelected(payload, wanted, candidate.total!)),
        ...base,
        decisionIds: [run.id],
    };
}

const DAY_MS = 86_400_000;
const tenths = (total: number) => Math.round(total * 10);

/**
 * Why a candidate that passed every filter is not on the list, read from the stored run only. When the list was
 * full, no cap of the selection could have kept it out, and every pick with a total no higher than its own was kept
 * as a seed or an incumbent, those picks and the rule that held each one are named: a seed, the minimum stay (days
 * listed at the run, from the starting state the run logged) or the newcomer margin. In any other case, or when the
 * run did not log its starting state, the note says it was outranked and lists the limits that apply.
 */
function whyNotSelected(payload: RunPayload, symbol: string, total: number): TextRef {
    const { picks, level, computedAt } = payload.result;
    const rule = RULES.selection;
    const margin = rule.slow_moving.newcomer_margin_points;
    const minDays = rule.slow_moving.min_days_listed;
    const outranked = serviceRef('svc.watchlist.not_selected', { symbol, total, picks: picks.length, level, maxPerSector: rule.max_per_sector, margin, minDays });
    const entry = payload.snapshot.signals.find((set) => set.symbol === symbol)?.entry ?? getEntry(symbol);
    if (!entry || picks.length < rule.top_n_by_level[level]) return outranked;
    const index = entry.assetClass === 'etf' ? entry.etf?.index : undefined;
    const capped = (entry.sector !== undefined && picks.filter((p) => p.sector === entry.sector).length >= rule.max_per_sector)
        || (index !== undefined && picks.filter((p) => p.assetClass === 'etf' && p.signals.entry.etf?.index === index).length >= rule.max_etfs_per_index)
        || (entry.assetClass === 'crypto' && picks.filter((p) => p.assetClass === 'crypto').length >= rule.max_crypto);
    if (capped || picks.some((p) => p.kept === 'new' && tenths(p.total) < tenths(total))) return outranked;
    const held = picks.filter((p) => p.kept !== 'new' && tenths(p.total) <= tenths(total));
    if (held.length === 0) return outranked;
    const kept = held.map((p): TextRef => {
        if (p.kept === 'seed') return serviceRef('svc.watchlist.kept_seed', { symbol: p.symbol, total: p.total });
        if (!payload.previous) return serviceRef('svc.watchlist.kept_incumbent', { symbol: p.symbol, total: p.total, margin, minDays });
        // As the selection counts them: whole days from the listing date to the run, an unknown date counting as the run's
        const since = Date.parse(own(payload.previous.listedSince, p.symbol) ?? computedAt);
        const days = Number.isNaN(since) ? 0 : Math.floor((Date.parse(computedAt) - since) / DAY_MS);
        if (days < minDays) return serviceRef('svc.watchlist.kept_min_stay', { symbol: p.symbol, total: p.total, days, minDays });
        const gap = tenths(total) - tenths(p.total);
        if (gap > Math.round(margin * 10)) return serviceRef('svc.watchlist.kept_incumbent', { symbol: p.symbol, total: p.total, margin, minDays });
        return serviceRef('svc.watchlist.kept_margin', { symbol: p.symbol, total: p.total, margin, gap: gap / 10 });
    });
    return serviceRef('svc.watchlist.kept_out', { symbol, total, picks: picks.length, kept });
}

/** Records what the user did with a card. 'add' brings a dismissed symbol back. */
export async function userAction(symbol: string, action: WatchlistAction, scope?: Scope): Promise<{ state: { pinned: string[]; dismissed: string[] } }> {
    const wanted = getEntry(symbol)?.symbol;
    if (!wanted) throw new ServiceError(404, serviceRef('svc.not_in_universe', { symbol }));
    const sc = await scopeOr(scope);
    const without = (list: string[]) => list.filter((s) => s !== wanted);
    const next = await updateState(sc, (state) => {
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
        userId: sc.scopeId,
        kind: 'user_action',
        symbol: wanted,
        snapshotId: (await lastRun(sc))?.snapshotId,
        ruleVersions: RULE_VERSIONS,
        payload: { action, state },
    });
    return { state };
}

/**
 * The build in progress for a scope. Without a scope (tests and scripts): whether any build is running, and a
 * promise that settles once every build running now has.
 */
export function buildStatus(scope?: Pick<Scope, 'scopeId'>): { building: boolean; progress: BuildProgress | null; promise: Promise<void> | null } {
    if (scope) {
        const current = builds().get(scope.scopeId);
        return { building: Boolean(current), progress: current?.progress ?? null, promise: current?.promise ?? null };
    }
    const all = [...builds().values()];
    if (all.length === 0) return { building: false, progress: null, promise: null };
    return { building: true, progress: all[0].progress, promise: Promise.all(all.map((b) => b.promise)).then(() => undefined) };
}

/** Test helper: forgets the runs held in memory and any build state. */
export function resetWatchlistMemory(): void {
    holder.__watchlistBuilds = new Map();
    holder.__watchlistRuns = new Map();
    holder.__watchlistFailures = new Map();
}
