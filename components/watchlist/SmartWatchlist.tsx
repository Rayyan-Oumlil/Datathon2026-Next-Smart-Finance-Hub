'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ListChecks, RefreshCw, Search, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Level, SignalSet, WatchlistResult } from "@/lib/domain/types";
import { cn } from "@/lib/utils";
import { formatPercent } from "@/i18n/format";
import { FACTOR_KEYS, factorLabel, factorShort, notAvailable, formatSignal, formatTime, isStale, kindLabel, marketLabel, missingLabel, ruleIdLabel, type FactorKey, type WatchlistRulesView } from "./format";
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
const LEVELS: Level[] = ['Novice', 'Intermediate', 'Expert'];

function ReferenceCard({ signals, quoteStaleSeconds }: { signals: SignalSet; quoteStaleSeconds: number }) {
    const t = useTranslations('Watchlist');
    const locale = useLocale();
    const value = signals.price;
    return (
        <li className="card flex flex-col gap-1 p-3.5">
            <p className="text-[12.5px] font-semibold text-muted-foreground">{signals.entry.name}</p>
            {value ? (
                <>
                    <p className="num text-lg font-bold text-foreground">{formatSignal('price', value, t, locale)}</p>
                    {/* Gold is a quote; a bond yield is published once a day, so it is judged as a daily value */}
                    <SourceLine sourced={value} stale={isStale(signals.entry.assetClass === 'bond_yield' ? 'closes1m' : 'price', value, quoteStaleSeconds)} />
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

function ScoreExplainer({ rules, onClose }: { rules: WatchlistRulesView; onClose: () => void }) {
    const t = useTranslations('Watchlist');
    const locale = useLocale();
    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-h-[90dvh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{t('explain.title')}</DialogTitle>
                    <DialogDescription>
                        {t('explain.intro', { version: rules.scoreVersion })}
                    </DialogDescription>
                </DialogHeader>
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
            </DialogContent>
        </Dialog>
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
            if (!res.ok) throw new Error(typeof body.error === 'string' ? body.error : t('list.loadFailedFallback'));
            setView(body);
            setLoadError(null);
        } catch (error) {
            setLoadError(error instanceof Error && error.message ? error.message : t('list.loadFailedFallback'));
        }
    }, [t]);

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
                {result && (
                    <div className="flex max-w-sm flex-col items-end gap-1">
                        <button type="button" className="btn btn-ghost h-9" disabled={building || busy === 'recompute'} onClick={() => void recompute()}>
                            <RefreshCw aria-hidden className={cn(building && 'animate-spin')} />{building ? t('list.recomputing') : t('list.recompute')}
                        </button>
                        <p role="status" aria-live="polite" className="text-end text-[12.5px] text-faint">
                            {skipped && t(`list.recomputeSkipped.${skipped}`)}
                        </p>
                    </div>
                )}
            </div>

            <div className="flex flex-col gap-3 p-1">
                <div className="card p-3 focus-within:border-brand focus-within:ring-2 focus-within:ring-ring">
                    <label className="flex items-center gap-2">
                        <Search aria-hidden className="size-4 flex-none text-faint" />
                        <span className="sr-only">{t('list.searchLabel')}</span>
                        <input
                            type="search" value={query} onChange={(e) => setQuery(e.target.value)} maxLength={40}
                            placeholder={t('list.searchPlaceholder')}
                            className="h-9 w-full min-w-0 bg-transparent text-foreground outline-none placeholder:text-faint focus-visible:ring-0"
                        />
                    </label>
                    {found && (
                        <ul className="mt-2 flex flex-col border-t border-line" aria-live="polite">
                            {searchFailed && <li role="alert" className="py-3 text-sm font-semibold text-down">{t('list.searchFailed')}</li>}
                            {found.length === 0 && !searchFailed && <li className="py-3 text-sm text-faint">{t('list.searchEmpty', { query: query.trim() })}</li>}
                            {found.map((entry) => (
                                <li key={entry.symbol} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-2 last:border-b-0">
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-semibold text-foreground">{entry.name} <span className="mono text-[12.5px] text-faint">({entry.symbol})</span></p>
                                        <p className="text-[12.5px] text-faint">{kindLabel(t, entry.assetClass, entry.sector)}{entry.market !== 'none' && ` · ${marketLabel(t, entry.market)}`}</p>
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                        <button type="button" className="btn btn-ghost h-8 px-2.5" onClick={() => setWhy(entry.symbol)}>{t('card.why')}</button>
                                        {(entry.assetClass === 'stock' || entry.assetClass === 'etf' || entry.assetClass === 'crypto') && (
                                            <>
                                                <Link href={`/stocks/${encodeURIComponent(entry.symbol)}`} className="btn btn-ghost h-8 px-2.5">{t('list.quotePage')}</Link>
                                                <button type="button" className="btn btn-ghost h-8 px-2.5" onClick={() => setTrade({ symbol: entry.symbol, name: entry.name })}>{t('card.addToPortfolio')}</button>
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

                        {level === 'Expert' && picks.length > 1 && (
                            <div role="group" aria-label={t('list.sortGroup')} className="flex flex-wrap items-center gap-1.5 px-1">
                                <span className="form-label">{t('list.sortBy')}</span>
                                {(['rank', 'total', ...FACTOR_KEYS] as SortKey[]).map((key) => (
                                    <button key={key} type="button" aria-pressed={sort === key} onClick={() => setSort(key)} className={cn('btn btn-ghost h-8 px-2.5 text-[12.5px]', sort === key && 'is-on')}>
                                        {key === 'rank' ? t('factors.sort.rank') : key === 'total' ? t('factors.sort.total') : factorShort(t, key)}
                                    </button>
                                ))}
                            </div>
                        )}

                        {picks.length === 0 ? (
                            <div className="card empty-state">
                                <span className="empty-icon"><ListChecks aria-hidden /></span>
                                <h3>{t('list.emptyTitle')}</h3>
                                <p className="max-w-md">
                                    {t('list.emptyBody', { candidates: result.candidates, rejected: result.rejected.length, dismissed: view?.state.dismissed.length ?? 0 })}
                                </p>
                            </div>
                        ) : (
                            <ul className={cn('grid gap-3', level === 'Expert' ? '@4xl:grid-cols-2' : '@2xl:grid-cols-2 @6xl:grid-cols-3')}>
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
                                {t('list.dismissedBy')}
                                {view.state.dismissed.map((symbol) => (
                                    <button key={symbol} type="button" className="btn btn-ghost h-7 px-2 text-[12.5px]" disabled={busy === symbol} onClick={() => void act(symbol, 'add')}>{t('list.restore', { symbol })}</button>
                                ))}
                            </p>
                        )}

                        <p className="px-1 text-[12.5px] leading-relaxed text-muted-foreground">
                            {t('list.rankingNote', { versions: Object.values(result.ruleVersions).join(', ') })} <span className="mono">{result.snapshotId}</span>.{' '}
                            <button type="button" className="font-semibold text-brand-ink underline underline-offset-2" onClick={() => setExplain(true)}>{t('list.howScoreWorks')}</button>
                        </p>

                        {result.referenceCards.length > 0 && (
                            <div className="flex flex-col gap-2 pt-1">
                                <div className="px-1">
                                    <h3 className="kicker">{t('list.referenceTitle')}</h3>
                                    <p className="text-[12.5px] text-faint">{t('list.referenceBody')}</p>
                                </div>
                                <ul className="grid gap-3 @xl:grid-cols-2 @4xl:grid-cols-4">
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
