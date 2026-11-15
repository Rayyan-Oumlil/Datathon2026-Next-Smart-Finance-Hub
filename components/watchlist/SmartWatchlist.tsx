'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ListChecks, RefreshCw, Search, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Level, SignalSet, WatchlistResult } from "@/lib/domain/types";
import { cn } from "@/lib/utils";
import { FACTOR_KEYS, FACTOR_LABEL, FACTOR_SHORT, NOT_AVAILABLE, formatSignal, formatTime, isStale, kindLabel, type FactorKey, type WatchlistRulesView } from "./format";
import { SourceLine } from "./parts";
import PickCard from "./PickCard";
import TradeDialog from "./TradeDialog";
import WhyPanel from "./WhyPanel";

// The answer of GET /api/watchlist
type View = {
    result: WatchlistResult | null;
    state: { pinned: string[]; dismissed: string[] };
    signalsDate: string | null;
    stale: boolean;
    building: boolean;
    progress: { startedAt: string; stage: 'signals' | 'ranking' | 'logging'; done: number; total: number; symbol?: string } | null;
    needsProfile?: true;
    error?: string;
};
type SearchEntry = { symbol: string; name: string; assetClass: string; sector?: string; market: string };
type SortKey = 'rank' | 'total' | FactorKey;

const POLL_MS = 5000;
const STAGE_TEXT = { signals: 'Collecting market data', ranking: 'Applying the filters and scoring', logging: 'Writing the run to the decision log' };
const DENSITY_TEXT: Record<Level, string> = {
    Novice: 'Novice view: facts only, no scores',
    Intermediate: 'Intermediate view: rank, score, top drivers and a 1-month line',
    Expert: 'Expert view: every factor, raw values and their sources',
};

function ReferenceCard({ signals, quoteStaleSeconds }: { signals: SignalSet; quoteStaleSeconds: number }) {
    const value = signals.price;
    return (
        <li className="card flex flex-col gap-1 p-3.5">
            <p className="text-[12.5px] font-semibold text-muted-foreground">{signals.entry.name}</p>
            {value ? (
                <>
                    <p className="num text-lg font-bold text-foreground">{formatSignal('price', value)}</p>
                    {/* Gold is a quote; a bond yield is published once a day, so it is judged as a daily value */}
                    <SourceLine sourced={value} stale={isStale(signals.entry.assetClass === 'bond_yield' ? 'closes1m' : 'price', value, quoteStaleSeconds)} />
                    {value.note && <p className="text-[11.5px] text-faint">{value.note}</p>}
                </>
            ) : (
                <>
                    <p className="text-lg font-bold text-faint">{NOT_AVAILABLE}</p>
                    <p className="text-[11.5px] text-faint">No source answered for: {signals.missing.join(', ') || 'this value'}. No placeholder is shown.</p>
                </>
            )}
        </li>
    );
}

function ScoreExplainer({ rules, onClose }: { rules: WatchlistRulesView; onClose: () => void }) {
    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-h-[90dvh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>How the score works</DialogTitle>
                    <DialogDescription>
                        Fixed rules ({rules.scoreVersion}), written in one rules file and run as plain code. Same inputs, same list. Not investment advice.
                    </DialogDescription>
                </DialogHeader>
                <ol className="flex flex-col gap-2 text-sm text-foreground">
                    <li><span className="font-semibold">1. Filters.</span> An asset is left out when it fails a pass-or-fail check of your profile (avoid list, markets, volatility cap, market cap floor, traded value, ESG tag as demo data).</li>
                    <li><span className="font-semibold">2. Score.</span> Each remaining asset gets four factors from 0 to 100, with fixed weights:</li>
                </ol>
                <ul className="flex flex-col gap-2.5">
                    {FACTOR_KEYS.map((key) => (
                        <li key={key} className="rounded-xl bg-hover p-3">
                            <p className="flex items-baseline justify-between gap-3 text-sm font-bold text-foreground">{FACTOR_LABEL[key]}<span className="num text-brand-ink">{rules.weights[key]}%</span></p>
                            <p className="text-[12.5px] text-muted-foreground">{rules.factors[key].meaning}. {rules.factors[key].formula}</p>
                        </li>
                    ))}
                </ul>
                <p className="text-sm text-foreground">Total = {rules.totalFormula}.</p>
                <p className="text-sm text-foreground">
                    <span className="font-semibold">3. Selection.</span> Highest totals first: up to {Object.entries(rules.topN).map(([level, n]) => `${n} for ${level}`).join(', ')}; at most {rules.maxPerSector} per sector and {rules.maxCrypto} crypto asset. The order is the same at every level; only the amount of detail changes.
                </p>
                <p className="text-[12.5px] text-faint">
                    Not part of the score: {rules.removedFromScore.join(', ').replaceAll('_', ' ')}. Never an input at any stage: {rules.neverAnInput.join(', ').replaceAll('_', ' ')}. The AI assistant does not pick, rank or score.
                </p>
            </DialogContent>
        </Dialog>
    );
}

export default function SmartWatchlist({ rules }: { rules: WatchlistRulesView }) {
    const [view, setView] = useState<View | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [sort, setSort] = useState<SortKey>('rank');
    const [why, setWhy] = useState<string | null>(null);
    const [trade, setTrade] = useState<{ symbol: string; name: string } | null>(null);
    const [explain, setExplain] = useState(false);
    const [query, setQuery] = useState('');
    const [found, setFound] = useState<SearchEntry[] | null>(null);
    const [searchFailed, setSearchFailed] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const load = useCallback(async () => {
        try {
            const res = await fetch('/api/watchlist', { cache: 'no-store' });
            const body = await res.json();
            if (!res.ok) throw new Error(typeof body.error === 'string' ? body.error : 'The watchlist could not be loaded.');
            setView(body);
            setLoadError(null);
        } catch (error) {
            setLoadError(error instanceof Error && error.message ? error.message : 'The watchlist could not be loaded.');
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    // The first build of a day can take minutes: ask again every 5 s until it is there
    const building = view?.building ?? false;
    useEffect(() => {
        if (!building) return;
        timer.current = setInterval(() => void load(), POLL_MS);
        return () => { if (timer.current) clearInterval(timer.current); };
    }, [building, load]);

    // Search over the app's own asset list
    useEffect(() => {
        const q = query.trim();
        if (!q) return setFound(null);
        let live = true;
        const wait = setTimeout(async () => {
            try {
                const res = await fetch(`/api/universe/search?q=${encodeURIComponent(q)}`);
                const body = await res.json();
                if (!live) return;
                const ok = res.ok && Array.isArray(body.entries);
                setFound(ok ? body.entries : []);
                setSearchFailed(!ok);
            } catch {
                if (live) { setFound([]); setSearchFailed(true); }
            }
        }, 250);
        return () => { live = false; clearTimeout(wait); };
    }, [query]);

    async function recompute() {
        setBusy('recompute');
        try {
            const res = await fetch('/api/watchlist/refresh', { method: 'POST' });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error);
            await load();
        } catch (error) {
            toast.error(error instanceof Error && error.message ? error.message : 'The recompute could not be started.');
        } finally {
            setBusy(null);
        }
    }

    async function act(symbol: string, action: 'add' | 'dismiss' | 'pin' | 'unpin') {
        setBusy(symbol);
        try {
            const res = await fetch('/api/watchlist/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbol, action }) });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body.error);
            // A dismissed card leaves the served list, so the list is read again
            await load();
        } catch (error) {
            toast.error(error instanceof Error && error.message ? error.message : 'The action could not be recorded.');
        } finally {
            setBusy(null);
        }
    }

    const result = view?.result ?? null;
    const level: Level = result?.level ?? 'Novice';
    const pinned = useMemo(() => new Set(view?.state.pinned ?? []), [view]);
    const picks = useMemo(() => {
        if (!result) return [];
        const shown = result.picks.slice(0, rules.topN[result.level] ?? result.picks.length);
        const value = (p: (typeof shown)[number]) => (sort === 'rank' ? -p.rank : sort === 'total' ? p.total : p.factors[sort].score);
        // Pinned cards come first; each keeps its own rank number
        return [...shown].sort((a, b) => Number(pinned.has(b.symbol)) - Number(pinned.has(a.symbol)) || value(b) - value(a) || a.rank - b.rank);
    }, [result, rules.topN, sort, pinned]);

    return (
        <section className="hatch" aria-labelledby="smart-watchlist-title">
            <div className="section-head flex-wrap">
                <div className="min-w-0">
                    <h2 id="smart-watchlist-title" className="section-title">Smart watchlist</h2>
                    <p className="section-sub">
                        {result
                            ? <>Updated once a day · computed {formatTime(result.computedAt)} · {result.picks.length} listed of {result.candidates} candidates · {DENSITY_TEXT[level]}</>
                            : 'Ranked by fixed rules from your profile. Simulation only, not investment advice.'}
                    </p>
                </div>
                {result && (
                    <button type="button" className="btn btn-ghost h-9" disabled={building || busy === 'recompute'} onClick={() => void recompute()}>
                        <RefreshCw aria-hidden className={cn(building && 'animate-spin')} />{building ? 'Recomputing…' : 'Recompute'}
                    </button>
                )}
            </div>

            <div className="flex flex-col gap-3 p-1">
                <div className="card p-3 focus-within:border-brand focus-within:ring-2 focus-within:ring-ring">
                    <label className="flex items-center gap-2">
                        <Search aria-hidden className="size-4 flex-none text-faint" />
                        <span className="sr-only">Search an asset by name or ticker</span>
                        <input
                            type="search" value={query} onChange={(e) => setQuery(e.target.value)} maxLength={40}
                            placeholder="Search a ticker or a company, then ask why it is or is not listed"
                            className="h-9 w-full min-w-0 bg-transparent text-foreground outline-none placeholder:text-faint focus-visible:ring-0"
                        />
                    </label>
                    {found && (
                        <ul className="mt-2 flex flex-col border-t border-line" aria-live="polite">
                            {searchFailed && <li role="alert" className="py-3 text-sm font-semibold text-down">The search did not answer. Try again.</li>}
                            {found.length === 0 && !searchFailed && <li className="py-3 text-sm text-faint">No asset in the app&apos;s list matches “{query.trim()}”.</li>}
                            {found.map((entry) => (
                                <li key={entry.symbol} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-2 last:border-b-0">
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-semibold text-foreground">{entry.name} <span className="mono text-[12.5px] text-faint">({entry.symbol})</span></p>
                                        <p className="text-[12.5px] text-faint">{kindLabel(entry.assetClass, entry.sector)}{entry.market !== 'none' && ` · ${entry.market}`}</p>
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                        <button type="button" className="btn btn-ghost h-8 px-2.5" onClick={() => setWhy(entry.symbol)}>Why?</button>
                                        {(entry.assetClass === 'stock' || entry.assetClass === 'etf' || entry.assetClass === 'crypto') && (
                                            <>
                                                <Link href={`/stocks/${encodeURIComponent(entry.symbol)}`} className="btn btn-ghost h-8 px-2.5">Quote page</Link>
                                                <button type="button" className="btn btn-ghost h-8 px-2.5" onClick={() => setTrade({ symbol: entry.symbol, name: entry.name })}>Add to simulated portfolio</button>
                                            </>
                                        )}
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                {loadError && !view && (
                    <div className="card empty-state" role="alert">
                        <span className="empty-icon"><TriangleAlert aria-hidden /></span>
                        <h3>The watchlist could not be loaded</h3>
                        <p>{loadError}</p>
                        <button type="button" className="btn btn-ghost mt-2" onClick={() => void load()}>Try again</button>
                    </div>
                )}
                {loadError && view && <p role="alert" className="card flex items-center gap-2 p-3 text-sm text-warn"><TriangleAlert aria-hidden className="size-4 flex-none" />The last check with the server did not go through ({loadError}). What is shown may be out of date.</p>}
                {!view && !loadError && <div className="card empty-state" aria-live="polite"><p>Loading the watchlist…</p></div>}

                {view?.needsProfile && (
                    <div className="card empty-state">
                        <span className="empty-icon"><ListChecks aria-hidden /></span>
                        <h3>No profile yet</h3>
                        <p>The watchlist is built from your profile answers. Nothing is listed until a profile exists.</p>
                        <Link href="/profile" className="btn btn-primary mt-2">Set up your profile</Link>
                    </div>
                )}

                {view?.error && (
                    <div className="card empty-state" role="alert">
                        <span className="empty-icon"><TriangleAlert aria-hidden /></span>
                        <h3>The watchlist could not be computed</h3>
                        <p>{view.error}</p>
                        <button type="button" className="btn btn-ghost mt-2" onClick={() => void load()}>Try again</button>
                    </div>
                )}

                {view && building && !result && (
                    <div className="card empty-state" role="status" aria-live="polite">
                        <span className="empty-icon"><RefreshCw aria-hidden className="animate-spin" /></span>
                        <h3>Building today&apos;s watchlist</h3>
                        <p>
                            {view.progress
                                ? <>{STAGE_TEXT[view.progress.stage]}{view.progress.total > 0 && <>: <span className="num">{view.progress.done} of {view.progress.total}</span> assets</>}{view.progress.symbol && view.progress.stage === 'signals' && <> (last: {view.progress.symbol})</>}. Started {formatTime(view.progress.startedAt)}.</>
                                : 'The run has started.'}
                        </p>
                        <p className="max-w-md text-[12.5px]">The first run of a day collects every input once, with its source and time, and can take a few minutes. This page checks again every 5 seconds.</p>
                    </div>
                )}

                {result && (
                    <>
                        {view?.stale && <p role="note" className="card flex items-center gap-2 p-3 text-sm text-warn"><TriangleAlert aria-hidden className="size-4 flex-none" />The daily inputs are from {view.signalsDate ?? 'an earlier day'}: today&apos;s collection did not complete. Values are shown with their real fetch times.</p>}

                        {level === 'Expert' && picks.length > 1 && (
                            <div role="group" aria-label="Sort the cards" className="flex flex-wrap items-center gap-1.5 px-1">
                                <span className="form-label">Sort by</span>
                                {(['rank', 'total', ...FACTOR_KEYS] as SortKey[]).map((key) => (
                                    <button key={key} type="button" aria-pressed={sort === key} onClick={() => setSort(key)} className={cn('btn btn-ghost h-8 px-2.5 text-[12.5px]', sort === key && 'is-on')}>
                                        {key === 'rank' ? 'Rank' : key === 'total' ? 'Total score' : FACTOR_SHORT[key]}
                                    </button>
                                ))}
                            </div>
                        )}

                        {picks.length === 0 ? (
                            <div className="card empty-state">
                                <span className="empty-icon"><ListChecks aria-hidden /></span>
                                <h3>Nothing is listed today</h3>
                                <p className="max-w-md">
                                    {result.candidates} candidates were checked and {result.rejected.length} did not pass your profile&apos;s filters
                                    {view && view.state.dismissed.length > 0 && <>; {view.state.dismissed.length} dismissed</>}. Search a ticker above and open “Why?” to see the check that left it out.
                                </p>
                            </div>
                        ) : (
                            <ul className={cn('grid gap-3', level === 'Expert' ? 'xl:grid-cols-2' : 'md:grid-cols-2 2xl:grid-cols-3')}>
                                {picks.map((pick) => (
                                    <PickCard
                                        key={pick.symbol} pick={pick} level={level} rules={rules} ruleVersions={result.ruleVersions}
                                        pinned={pinned.has(pick.symbol)} busy={busy === pick.symbol}
                                        onWhy={() => setWhy(pick.symbol)}
                                        onTrade={() => setTrade({ symbol: pick.symbol, name: pick.name })}
                                        onPin={() => void act(pick.symbol, pinned.has(pick.symbol) ? 'unpin' : 'pin')}
                                        onDismiss={() => void act(pick.symbol, 'dismiss')}
                                    />
                                ))}
                            </ul>
                        )}

                        {view && view.state.dismissed.length > 0 && (
                            <p className="flex flex-wrap items-center gap-1.5 px-1 text-[12.5px] text-faint">
                                Dismissed by you:
                                {view.state.dismissed.map((symbol) => (
                                    <button key={symbol} type="button" className="btn btn-ghost h-7 px-2 text-[12.5px]" disabled={busy === symbol} onClick={() => void act(symbol, 'add')}>{symbol} · restore</button>
                                ))}
                            </p>
                        )}

                        <p className="px-1 text-[12.5px] leading-relaxed text-muted-foreground">
                            The ranking is computed by fixed rules ({Object.values(result.ruleVersions).join(', ')}), the same for every level; only the amount of detail changes. The AI does not pick or rank. Snapshot <span className="mono">{result.snapshotId}</span>.{' '}
                            <button type="button" className="font-semibold text-brand-ink underline underline-offset-2" onClick={() => setExplain(true)}>How the score works</button>
                        </p>

                        {result.referenceCards.length > 0 && (
                            <div className="flex flex-col gap-2 pt-1">
                                <div className="px-1">
                                    <h3 className="kicker">Reference values, not ranked</h3>
                                    <p className="text-[12.5px] text-faint">Gold and Government of Canada bond yields, shown for context. A yield is not a price, so these are never scored.</p>
                                </div>
                                <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                                    {result.referenceCards.map((signals) => <ReferenceCard key={signals.symbol} signals={signals} quoteStaleSeconds={rules.quoteStaleSeconds} />)}
                                </ul>
                            </div>
                        )}
                    </>
                )}
            </div>

            {why && <WhyPanel symbol={why} rules={rules} onClose={() => setWhy(null)} />}
            {trade && <TradeDialog symbol={trade.symbol} name={trade.name} onClose={() => setTrade(null)} />}
            {explain && <ScoreExplainer rules={rules} onClose={() => setExplain(false)} />}
        </section>
    );
}
