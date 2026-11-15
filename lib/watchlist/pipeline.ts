import type { Candidate, SignalSet, Snapshot, UniverseEntry, WatchlistResult } from '@/lib/domain/types';
import type { Rules } from '@/lib/rules';
import { runFilters } from '@/lib/watchlist/filters';
import type { ProfileView } from '@/lib/watchlist/format';
import { buildReason } from '@/lib/watchlist/reasons';
import { scoreCandidate, sectorMedianPe } from '@/lib/watchlist/score';
import { selectPicks, type PreviousList } from '@/lib/watchlist/selection';
import { selectCandidates } from '@/lib/watchlist/universe-select';

export type PipelineInput = {
    snapshot: Snapshot;
    universe: UniverseEntry[];
    rules: Rules;
    previous?: PreviousList;   // the last run's list; leave out on the first run
    now: string;
};

export type PipelineOutput = {
    result: WatchlistResult;
    candidates: Candidate[];   // every candidate with its filter checks and, when it passed, its scores: what the decision log stores
    next: PreviousList;        // to store and pass back as `previous` on the next run
};

/**
 * The whole smart-watchlist run: universe -> filters -> score -> selection -> reason sentences.
 * Pure: the result depends only on the input, never on the order of the universe or of the snapshot's signals.
 */
export function runPipeline({ snapshot, universe, rules, previous, now }: PipelineInput): PipelineOutput {
    const profile: ProfileView = snapshot.profile;
    const signalsBySymbol = new Map<string, SignalSet>();
    for (const signals of snapshot.signals) {
        if (!signalsBySymbol.has(signals.symbol)) signalsBySymbol.set(signals.symbol, signals);
    }

    const candidates: Candidate[] = selectCandidates(universe, profile).candidates.map((entry) => {
        const collected = signalsBySymbol.get(entry.symbol);
        if (!collected) {
            // In the universe but absent from the snapshot: rejected as missing data, never filled in.
            const signals: SignalSet = { symbol: entry.symbol, entry, missing: ['all signals'] };
            const filters = [{ filter: 'data' as const, pass: false, detail: `no signals were collected for ${entry.symbol} in this snapshot` }];
            return { symbol: entry.symbol, signals, filters, passed: false };
        }
        const filters = runFilters(collected, profile, rules, snapshot.fxUsdCad);
        return { symbol: entry.symbol, signals: collected, filters, passed: filters.every((check) => check.pass) };
    });

    // Gold and bond yields are shown beside the list and never scored or ranked.
    const isReference = (c: Candidate) => c.signals.entry.assetClass === 'gold' || c.signals.entry.assetClass === 'bond_yield';
    const ranked = candidates.filter((c) => c.passed && !isReference(c));
    const context = { sectorMedianPe: sectorMedianPe(ranked.map((c) => c.signals)), holdings: snapshot.holdings };
    for (const candidate of ranked) {
        const { factors, total } = scoreCandidate(candidate.signals, profile, rules, context);
        candidate.factors = factors;
        candidate.total = total;
    }

    const selection = selectPicks(ranked, profile, rules, previous ?? { listedSince: {}, previousPicks: [] }, now);
    const sectorOf: Record<string, string> = {};
    for (const entry of universe) {
        if (entry.sector !== undefined && !(entry.symbol in sectorOf)) sectorOf[entry.symbol] = entry.sector;
    }
    const picks = selection.picks.map((pick) => ({ ...pick, reason: buildReason(pick, profile, snapshot.holdings, { sectorOf, rules }) }));

    const result: WatchlistResult = {
        snapshotId: snapshot.id,
        computedAt: now,
        ruleVersions: {
            filters: rules.filters.version,
            score: rules.score.version,
            selection: rules.selection.version,
            reasons: rules.reasons.version,
        },
        level: profile.level,
        risk: profile.risk,
        picks,
        referenceCards: candidates.filter((c) => c.passed && isReference(c)).map((c) => c.signals),
        rejected: candidates.filter((c) => !c.passed).map((c) => ({ symbol: c.symbol, failed: c.filters.filter((check) => !check.pass) })),
        candidates: candidates.length,
    };
    return { result, candidates, next: { listedSince: selection.listedSince, previousPicks: picks.map((pick) => pick.symbol) } };
}
