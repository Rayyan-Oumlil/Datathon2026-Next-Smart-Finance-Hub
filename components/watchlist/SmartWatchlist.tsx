'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ChevronDown, ListChecks, Rows3, RefreshCw, Search, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import AssetLogo from "@/components/AssetLogo";
import type { AssetClass, Level, SignalSet, Sourced, WatchlistResult } from "@/lib/domain/types";
import { useDataChanged } from "@/hooks/useDataChanged";
import { cn } from "@/lib/utils";
import { formatPercent } from "@/i18n/format";
import { FACTOR_KEYS, factorLabel, factorShort, notAvailable, formatSignal, formatTime, isStale, kindLabel, marketLabel, missingLabel, ruleIdLabel, type FactorKey, type SignalKey, type WatchlistRulesView } from "./format";
import { Mark, SourceLegend, StaleChip } from "./parts";
import PickCard, { CARD_VALUE_KEYS } from "./PickCard";
import { buildSourceMarks, type MarkOf } from "./sources";
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
const LEVELS: Level[] = ['Novice', 'Intermediate', 'Expert'];
const ASSET_CLASSES: AssetClass[] = ['stock', 'etf', 'crypto', 'gold', 'bond_yield'];
const asAssetClass = (value: string) => (ASSET_CLASSES as string[]).includes(value) ? value as AssetClass : undefined;
const COMPACT_KEY = 'watchlist.compact';
// Order in which a card shows its figures: the quote first, then the 1-month curve, then the folded values
const MARK_ORDER: SignalKey[] = ['price', 'changePercent', 'closes1m', ...CARD_VALUE_KEYS.filter((k) => k !== 'price' && k !== 'changePercent' && k !== 'closes1m')];

/** A section under the list, closed by default */
function Fold({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
    return (
        <details className="card group">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3.5 py-2.5 text-sm font-semibold text-foreground [&::-webkit-details-marker]:hidden">
                <span className="min-w-0">{title}</span>
                <ChevronDown aria-hidden className="size-4 flex-none text-faint transition-transform group-open:rotate-180" />
            </summary>
            <div className="flex flex-col gap-3 border-t border-line px-3.5 py-3">{children}</div>
        </details>
    );
}

function ReferenceCard({ signals, quoteStaleSeconds, markOf }: { signals: SignalSet; quoteStaleSeconds: number; markOf: MarkOf }) {
    const t = useTranslations('Watchlist');
    const locale = useLocale();
    const value = signals.price;
    return (
        <li className="card flex min-w-0 flex-col gap-1 p-3.5">
            <p className="flex min-w-0 items-center gap-2 text-[12.5px] font-semibold text-muted-foreground">
                <AssetLogo symbol={signals.symbol} name={signals.entry.name} assetClass={signals.entry.assetClass} size={24} />
                <span className="min-w-0 truncate" title={signals.entry.name}>{signals.entry.name}</span>
            </p>
            {value ? (
                <>
                    <p className="num text-lg font-bold text-foreground">{formatSignal('price', value, t, locale)}<Mark mark={markOf(value)} sourced={value} /></p>
                    {/* Gold is a quote; a bond yield is published once a day, so it is judged as a daily value */}
                    {isStale(signals.entry.assetClass === 'bond_yield' ? 'closes1m' : 'price', value, quoteStaleSeconds) && <span title={formatTime(value.fetchedAt, t, locale)}><StaleChip>{t('list.referenceStale')}</StaleChip></span>}
                    {value.note && <p className="text-[11.5px] text-faint">{value.note}</p>}
                </>
            ) : (
                <>
                    <p className="text-lg font-bold text-faint">{notAvailable(t)}</p>
                    <p className="text-[11.5px] text-faint">{t('list.noSourceFor', { list: signals.missing.map((m) => missingLabel(t, m)).join(', ') || t('list.thisValue') })}</p>
                </>
            )}
        </li>
    );
}

function ScoreExplainer({ rules }: { rules: WatchlistRulesView }) {
    const t = useTranslations('Watchlist');
    const locale = useLocale();
    return (
        <>
                <p className="text-[12.5px] text-muted-foreground">{t('explain.intro', { version: rules.scoreVersion })}</p>
                <ol className="flex flex-col gap-2 text-sm text-foreground">
                    <li><span className="font-semibold">{t('explain.filtersHead')}</span>{t('explain.filtersBody')}</li>
                    <li><span className="font-semibold">{t('explain.scoreHead')}</span>{t('explain.scoreBody')}</li>
                </ol>
                <ul className="flex flex-col gap-2.5">
                    {FACTOR_KEYS.map((key) => (
                        <li key={key} className="rounded-xl bg-hover p-3">
                            <p className="flex items-baseline justify-between gap-3 text-sm font-bold text-foreground">{factorLabel(t, key)}<span className="num text-brand-ink">{formatPercent(rules.weights[key], locale)}</span></p>
                            <p className="text-[12.5px] text-muted-foreground">{rules.factors[key].meaning}. {rules.factors[key].formula}</p>
                        </li>
                    ))}
                </ul>
                <p className="text-sm text-foreground">{t('explain.total', { formula: rules.totalFormula })}</p>
                <p className="text-sm text-foreground">
                    <span className="font-semibold">{t('explain.selectionHead')}</span>{t('explain.selectionBody', { topN: Object.entries(rules.topN).map(([level, n]) => (LEVELS.includes(level as Level) ? t(`explain.topN.${level}`, { n }) : `${n} ${level}`)).join(', '), perSector: rules.maxPerSector, maxCrypto: rules.maxCrypto })}
                </p>
                <p className="text-[12.5px] text-faint">
                    {t('explain.notScored', { removed: rules.removedFromScore.map((id) => ruleIdLabel(t, id)).join(', '), never: rules.neverAnInput.map((id) => ruleIdLabel(t, id)).join(', ') })}
                </p>
        </>
    );
}

export default function SmartWatchlist({ rules }: { rules: WatchlistRulesView }) {
    const t = useTranslations('Watchlist');
    const locale = useLocale();
    const [view, setView] = useState<View | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    // Why the last Recompute started nothing (the service's reason code), shown next to the button
    const [skipped, setSkipped] = useState<'already_current' | 'building' | null>(null);
    const [sort, setSort] = useState<SortKey>('rank');
    const [why, setWhy] = useState<string | null>(null);
    const [trade, setTrade] = useState<{ symbol: string; name: string; assetClass?: AssetClass } | null>(null);
    // Dense one-row cards; remembered in this browser only
    const [compact, setCompact] = useState(false);
    const [query, setQuery] = useState('');
    const [found, setFound] = useState<SearchEntry[] | null>(null);
    const [searchFailed, setSearchFailed] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const load = useCallback(async () => {
        try {
            const res = await fetch('/api/watchlist', { cache: 'no-store' });
            const body = await res.json();
            if (!res.ok) throw new Error(typeof body.error === 'string' ? body.error : t('list.loadFailedFallback'));
            // While a new list is being built, the one on screen stays (marked as recomputing) instead of an empty card
            setView((previous) => (body.building && !body.result && !body.needsProfile && !body.error && previous?.result
                ? { ...body, result: previous.result, signalsDate: previous.signalsDate, stale: previous.stale }
                : body));
            setLoadError(null);
        } catch (error) {
            setLoadError(error instanceof Error && error.message ? error.message : t('list.loadFailedFallback'));
        }
    }, [t]);

    useEffect(() => { void load(); }, [load]);
    // A change saved by the agent (profile, simulated portfolio): read the list again, keeping what is on screen meanwhile
    useDataChanged(() => void load());

    useEffect(() => {
        try { setCompact(window.localStorage.getItem(COMPACT_KEY) === '1'); } catch { /* storage blocked: default view */ }
    }, []);
    function toggleCompact() {
        const next = !compact;
        setCompact(next);
        try { window.localStorage.setItem(COMPACT_KEY, next ? '1' : '0'); } catch { /* storage blocked: kept for this visit */ }
    }

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
        setSkipped(null);
        try {
            const res = await fetch('/api/watchlist/refresh', { method: 'POST' });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body.error);
            if (body.started === false) setSkipped(body.reasonCode === 'building' ? 'building' : 'already_current');
            await load();
        } catch (error) {
            toast.error(error instanceof Error && error.message ? error.message : t('list.recomputeFailed'));
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
            toast.error(error instanceof Error && error.message ? error.message : t('list.actionFailed'));
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

    // One marker per source, in order of first appearance on the cards, then on the reference cards
    const marks = useMemo(() => buildSourceMarks([
        ...picks.flatMap((p) => MARK_ORDER.map((key) => p.signals[key] as Sourced<unknown> | undefined)),
        ...(result?.referenceCards ?? []).map((r) => r.price),
    ]), [picks, result]);

    return (
        <section className="hatch" aria-labelledby="smart-watchlist-title">
            <div className="section-head flex-wrap">
                <div className="min-w-0">
                    <h2 id="smart-watchlist-title" className="section-title">{t('list.title')}</h2>
                    <p className="section-sub">
                        {result
                            ? t('list.subResult', { time: formatTime(result.computedAt, t, locale), listed: result.picks.length, candidates: result.candidates, density: t(`levelView.${level}`) })
                            : t('list.subEmpty')}
                    </p>
                </div>
            </div>

            <div className="flex flex-col gap-3 p-1">
                <div className="@container card p-2">
                    <div role="toolbar" aria-label={t('list.toolbarLabel')} className="flex flex-wrap items-center gap-2">
                        <label className="flex h-9 min-w-[12rem] flex-1 items-center gap-2 rounded-[10px] px-2 focus-within:ring-2 focus-within:ring-ring">
                            <Search aria-hidden className="size-4 flex-none text-faint" />
                            <span className="sr-only">{t('list.searchLabel')}</span>
                            <input
                                type="search" value={query} onChange={(e) => setQuery(e.target.value)} maxLength={40}
                                placeholder={t('list.searchPlaceholderShort')} title={t('list.searchPlaceholder')}
                                className="h-9 w-full min-w-0 bg-transparent text-foreground outline-none placeholder:text-faint focus-visible:ring-0"
                            />
                        </label>
                        {result && (
                            <span className="flex flex-none items-center gap-1.5">
                                {level === 'Expert' && picks.length > 1 && (
                                    <label className="flex items-center gap-1.5">
                                        <span className="sr-only">{t('list.sortBy')}</span>
                                        <select
                                            value={sort} onChange={(e) => setSort(e.target.value as SortKey)}
                                            className="h-9 max-w-[9.5rem] rounded-[10px] border border-line bg-card px-2 text-[12.5px] font-semibold text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                        >
                                            {(['rank', 'total', ...FACTOR_KEYS] as SortKey[]).map((key) => (
                                                <option key={key} value={key}>{t('list.sortOption', { label: key === 'rank' ? t('factors.sort.rank') : key === 'total' ? t('factors.sort.total') : factorShort(t, key) })}</option>
                                            ))}
                                        </select>
                                    </label>
                                )}
                                <button type="button" className="btn btn-ghost h-9 px-2.5" disabled={building || busy === 'recompute'} onClick={() => void recompute()} title={t('list.recompute')}>
                                    <RefreshCw aria-hidden className={cn(building && 'animate-spin')} /><span className="hidden @lg:inline">{building ? t('list.recomputing') : t('list.recompute')}</span><span className="sr-only @lg:hidden">{building ? t('list.recomputing') : t('list.recompute')}</span>
                                </button>
                                <button type="button" className={cn('btn btn-ghost h-9 px-2.5', compact && 'is-on')} aria-pressed={compact} onClick={toggleCompact} title={t('list.compact')}>
                                    <Rows3 aria-hidden /><span className="hidden @lg:inline">{t('list.compact')}</span><span className="sr-only @lg:hidden">{t('list.compact')}</span>
                                </button>
                            </span>
                        )}
                    </div>
                    <p role="status" aria-live="polite" className={cn('px-2 text-[12.5px] text-faint', skipped && 'pt-1')}>
                        {skipped && t(`list.recomputeSkipped.${skipped}`)}
                    </p>
                    {found && (
                        <ul className="mt-1 flex flex-col border-t border-line px-1" aria-live="polite">
                            {searchFailed && <li role="alert" className="py-3 text-sm font-semibold text-down">{t('list.searchFailed')}</li>}
                            {found.length === 0 && !searchFailed && <li className="py-3 text-sm text-faint">{t('list.searchEmpty', { query: query.trim() })}</li>}
                            {found.map((entry) => (
                                <li key={entry.symbol} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-2 last:border-b-0">
                                    <div className="flex min-w-0 items-center gap-2.5">
                                        <AssetLogo symbol={entry.symbol} name={entry.name} assetClass={asAssetClass(entry.assetClass)} size={28} />
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-semibold text-foreground">{entry.name} <span className="mono text-[12.5px] text-faint">({entry.symbol})</span></p>
                                            <p className="truncate text-[12.5px] text-faint">{kindLabel(t, entry.assetClass, entry.sector)}{entry.market !== 'none' && ` · ${marketLabel(t, entry.market)}`}</p>
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                        <button type="button" className="btn btn-ghost h-8 px-2.5" onClick={() => setWhy(entry.symbol)}>{t('card.why')}</button>
                                        {(entry.assetClass === 'stock' || entry.assetClass === 'etf' || entry.assetClass === 'crypto') && (
                                            <>
                                                <Link href={`/stocks/${encodeURIComponent(entry.symbol)}`} className="btn btn-ghost h-8 px-2.5">{t('list.quotePage')}</Link>
                                                <button type="button" className="btn btn-ghost h-8 px-2.5" onClick={() => setTrade({ symbol: entry.symbol, name: entry.name, assetClass: asAssetClass(entry.assetClass) })}>{t('card.addToPortfolio')}</button>
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
                        <h3>{t('list.loadFailedTitle')}</h3>
                        <p>{loadError}</p>
                        <button type="button" className="btn btn-ghost mt-2" onClick={() => void load()}>{t('list.tryAgain')}</button>
                    </div>
                )}
                {loadError && view && <p role="alert" className="card flex items-center gap-2 p-3 text-sm text-warn"><TriangleAlert aria-hidden className="size-4 flex-none" />{t('list.outOfDate', { error: loadError })}</p>}
                {!view && !loadError && <div className="card empty-state" aria-live="polite"><p>{t('list.loading')}</p></div>}

                {view?.needsProfile && (
                    <div className="card empty-state">
                        <span className="empty-icon"><ListChecks aria-hidden /></span>
                        <h3>{t('list.noProfileTitle')}</h3>
                        <p>{t('list.noProfileBody')}</p>
                        <Link href="/profile" className="btn btn-primary mt-2">{t('list.setUpProfile')}</Link>
                    </div>
                )}

                {view?.error && (
                    <div className="card empty-state" role="alert">
                        <span className="empty-icon"><TriangleAlert aria-hidden /></span>
                        <h3>{t('list.computeFailedTitle')}</h3>
                        <p>{view.error}</p>
                        <button type="button" className="btn btn-ghost mt-2" onClick={() => void load()}>{t('list.tryAgain')}</button>
                    </div>
                )}

                {view && building && !result && (
                    <div className="card empty-state" role="status" aria-live="polite">
                        <span className="empty-icon"><RefreshCw aria-hidden className="animate-spin" /></span>
                        <h3>{t('list.buildingTitle')}</h3>
                        <p>
                            {view.progress
                                ? t('list.progress', {
                                    stage: t(`stage.${view.progress.stage}`),
                                    hasTotal: String(view.progress.total > 0),
                                    done: view.progress.done,
                                    total: view.progress.total,
                                    hasSymbol: String(Boolean(view.progress.symbol) && view.progress.stage === 'signals'),
                                    symbol: view.progress.symbol ?? '',
                                    time: formatTime(view.progress.startedAt, t, locale),
                                })
                                : t('list.runStarted')}
                        </p>
                        <p className="max-w-md text-[12.5px]">{t('list.buildingNote', { seconds: POLL_MS / 1000 })}</p>
                    </div>
                )}

                {result && (
                    <>
                        {view?.stale && <p role="note" className="card flex items-center gap-2 p-3 text-sm text-warn"><TriangleAlert aria-hidden className="size-4 flex-none" />{t('list.staleInputs', { date: view.signalsDate ? formatTime(view.signalsDate, t, locale) : t('list.earlierDay') })}</p>}

                        {picks.length === 0 ? (
                            <div className="card empty-state">
                                <span className="empty-icon"><ListChecks aria-hidden /></span>
                                <h3>{t('list.emptyTitle')}</h3>
                                <p className="max-w-md">
                                    {t('list.emptyBody', { candidates: result.candidates, rejected: result.rejected.length, dismissed: view?.state.dismissed.length ?? 0 })}
                                </p>
                            </div>
                        ) : (
                            <ul aria-busy={building || busy === 'recompute'} className={cn('grid gap-3 transition-opacity', compact ? 'gap-1.5' : level === 'Expert' ? '@4xl:grid-cols-2' : '@2xl:grid-cols-2 @6xl:grid-cols-3', building && 'opacity-70')}>
                                {picks.map((pick) => (
                                    <PickCard
                                        key={pick.symbol} pick={pick} level={level} rules={rules} ruleVersions={result.ruleVersions}
                                        pinned={pinned.has(pick.symbol)} busy={busy === pick.symbol} compact={compact} markOf={marks.markOf}
                                        onWhy={() => setWhy(pick.symbol)}
                                        onTrade={() => setTrade({ symbol: pick.symbol, name: pick.name, assetClass: pick.assetClass })}
                                        onPin={() => void act(pick.symbol, pinned.has(pick.symbol) ? 'unpin' : 'pin')}
                                        onDismiss={() => void act(pick.symbol, 'dismiss')}
                                    />
                                ))}
                            </ul>
                        )}

                        <SourceLegend entries={marks.entries} />

                        <div className="flex flex-col gap-2">
                            {view && view.state.dismissed.length > 0 && (
                                <Fold title={t('list.dismissedTitle', { count: view.state.dismissed.length })}>
                                    <p className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-faint">
                                        {view.state.dismissed.map((symbol) => (
                                            <button key={symbol} type="button" className="btn btn-ghost h-8 gap-1.5 px-2 text-[12.5px]" disabled={busy === symbol} onClick={() => void act(symbol, 'add')}>
                                                <AssetLogo symbol={symbol} size={18} />{t('list.restore', { symbol })}
                                            </button>
                                        ))}
                                    </p>
                                </Fold>
                            )}

                            {result.referenceCards.length > 0 && (
                                <Fold title={t('list.referenceTitle')}>
                                    <p className="text-[12.5px] text-faint">{t('list.referenceBody')}</p>
                                    <ul className="grid gap-3 @xl:grid-cols-2 @4xl:grid-cols-4">
                                        {result.referenceCards.map((signals) => <ReferenceCard key={signals.symbol} signals={signals} quoteStaleSeconds={rules.quoteStaleSeconds} markOf={marks.markOf} />)}
                                    </ul>
                                </Fold>
                            )}

                            <Fold title={t('list.howScoreWorks')}>
                                <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                                    {t('list.rankingNote', { versions: Object.values(result.ruleVersions).join(', ') })} <span className="mono break-all">{result.snapshotId}</span>.
                                </p>
                                <ScoreExplainer rules={rules} />
                            </Fold>
                        </div>
                    </>
                )}
            </div>

            {why && <WhyPanel symbol={why} rules={rules} onClose={() => setWhy(null)} />}
            {trade && <TradeDialog symbol={trade.symbol} name={trade.name} assetClass={trade.assetClass} onClose={() => setTrade(null)} />}
        </section>
    );
}
