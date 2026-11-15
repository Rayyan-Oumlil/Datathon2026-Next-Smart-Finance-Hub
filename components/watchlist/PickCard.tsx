'use client';

import Link from "next/link";
import { Pin, PinOff, Plus, X } from "lucide-react";
import ChangePill from "@/components/ChangePill";
import type { Level, Pick, Sourced } from "@/lib/domain/types";
import { cn } from "@/lib/utils";
import {
    FACTOR_KEYS, FACTOR_SHORT, NOT_AVAILABLE, SIGNAL_LABEL,
    formatSignal, formatTime, isStale, kindLabel, signedPct, staleSummary, type SignalKey, type WatchlistRulesView,
} from "./format";
import { EsgChip, SourceLine, Sparkline, StaleChip } from "./parts";

type Props = {
    pick: Pick;
    level: Level;
    pinned: boolean;
    busy: boolean;
    rules: WatchlistRulesView;
    ruleVersions: Record<string, string>;
    onWhy: () => void;
    onTrade: () => void;
    onPin: () => void;
    onDismiss: () => void;
};

// Raw values on the Expert card, each with its source and fetch time
const EXPERT_ROWS: SignalKey[] = ['price', 'changePercent', 'pe', 'revenueGrowthPct', 'volatility1y', 'beta', 'marketCapUsd', 'avgDailyTradedValueUsd', 'newsCount7d'];

/** One ranked card. The ranking is the same at every level; only how much of it is shown changes. */
export default function PickCard({ pick, level, pinned, busy, rules, ruleVersions, onWhy, onTrade, onPin, onDismiss }: Props) {
    const { signals } = pick;
    const move = signals.changePercent?.value;
    const stale = staleSummary(signals, rules.quoteStaleSeconds);
    const quote = signals.price ?? signals.changePercent;
    const quoteTime = quote?.fetchedAt;
    const novice = level === 'Novice';
    const expert = level === 'Expert';
    // Novice sentence: the reason, or sector and move when no template applied
    const fact = pick.reason?.text
        ?? [pick.sector ?? kindLabel(pick.assetClass), move != null ? `moved ${signedPct(move)} today` : null].filter(Boolean).join(', ');

    return (
        <li className="card flex flex-col gap-3 p-4">
            <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                    {!novice && <span className="num grid size-8 flex-none place-items-center rounded-full bg-brand-soft text-[13px] font-bold text-brand-ink" aria-label={`Rank ${pick.rank}`}>{pick.rank}</span>}
                    <div className="min-w-0">
                        <h3 className="truncate text-[15px] font-bold text-foreground">
                            <Link href={`/stocks/${encodeURIComponent(pick.symbol)}`} className="hover:underline focus-visible:underline">{pick.name}</Link>{' '}
                            <span className="mono text-[12.5px] font-semibold text-faint">({pick.symbol})</span>
                        </h3>
                        <p className="text-[12.5px] text-faint">{kindLabel(pick.assetClass, pick.sector)}{pinned && ' · pinned'}</p>
                    </div>
                </div>
                <div className="flex flex-none flex-col items-end gap-1">
                    {move != null ? <ChangePill value={move} /> : <span className="pill">move {NOT_AVAILABLE}</span>}
                    {!novice && <span className="num text-[13px] font-semibold text-foreground">{formatSignal('price', signals.price)}</span>}
                </div>
            </div>

            <p className="text-sm text-foreground">{fact}</p>
            {/* The Expert card lists every value with its source below; the other levels still say where the quote is from */}
            {!expert && quote && <p><SourceLine sourced={quote} label="Quote" /></p>}

            {!novice && (
                <div className="flex flex-wrap items-end justify-between gap-3">
                    <div className="flex flex-col gap-1.5">
                        <p className="text-sm text-muted-foreground">Score <span className="num text-lg font-bold text-foreground">{pick.total.toFixed(1)}</span> <span className="text-faint">/ 100</span></p>
                        {!expert && (
                            <p className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-faint">
                                Top drivers:
                                {pick.topDrivers.slice(0, 2).map((key) => <span key={key} className="pill">{FACTOR_SHORT[key]} <span className="num">{pick.factors[key].score.toFixed(0)}</span></span>)}
                            </p>
                        )}
                    </div>
                    {signals.closes1m && signals.closes1m.value.length > 1 && (
                        <div className="flex flex-col items-end">
                            <Sparkline closes={signals.closes1m.value} label={`${pick.symbol} daily closes over one month`} />
                            <span className="text-[11px] text-faint">1 month · {signals.closes1m.source}</span>
                        </div>
                    )}
                </div>
            )}

            {expert && (
                <>
                    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {FACTOR_KEYS.map((key) => (
                            <div key={key} className="rounded-lg bg-hover px-2.5 py-1.5" title={pick.factors[key].detail}>
                                <dt className="text-[11.5px] text-faint">{FACTOR_SHORT[key]} · {rules.weights[key]}%</dt>
                                <dd className="num text-sm font-bold text-foreground">{pick.factors[key].score.toFixed(1)}{pick.factors[key].noData && <span className="font-normal text-faint"> no data</span>}</dd>
                            </div>
                        ))}
                    </dl>
                    <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
                        {EXPERT_ROWS.map((key) => {
                            const sourced = signals[key] as Sourced<unknown> | undefined;
                            return (
                                <div key={key} className="min-w-0">
                                    <div className="flex items-baseline justify-between gap-2 text-[13px]">
                                        <dt className="text-muted-foreground">{SIGNAL_LABEL[key]}</dt>
                                        <dd className={cn('num font-semibold', sourced ? 'text-foreground' : 'text-faint')}>{formatSignal(key, sourced)}</dd>
                                    </div>
                                    {sourced && <SourceLine sourced={sourced} stale={isStale(key, sourced, rules.quoteStaleSeconds)} />}
                                </div>
                            );
                        })}
                    </dl>
                    <p className="text-[12.5px] leading-snug text-muted-foreground"><span className="font-semibold">P/E against the sector:</span> {pick.factors.fundamentals.detail}</p>
                    <p className="mono text-[11.5px] text-faint">{Object.values(ruleVersions).join(' · ')}</p>
                </>
            )}

            <div className="flex flex-wrap items-center gap-1.5">
                <EsgChip tag={signals.entry.esg} />
                {stale.quote && quoteTime && <StaleChip>Quote from {formatTime(quoteTime)}, not live</StaleChip>}
                {stale.daily && <StaleChip>Daily values from before today</StaleChip>}
            </div>

            <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-line pt-3">
                <button type="button" className="btn btn-ghost h-9" onClick={onWhy}>Why?</button>
                <button type="button" className="btn btn-primary h-9" onClick={onTrade}><Plus aria-hidden />Add to simulated portfolio</button>
                <span className="ms-auto flex gap-1">
                    <button type="button" className={cn('btn btn-ghost h-9 px-2.5', pinned && 'is-on')} aria-pressed={pinned} disabled={busy} onClick={onPin}>
                        {pinned ? <PinOff aria-hidden /> : <Pin aria-hidden />}{pinned ? 'Unpin' : 'Pin'}
                    </button>
                    <button type="button" className="btn btn-ghost h-9 px-2.5" disabled={busy} onClick={onDismiss}><X aria-hidden />Dismiss</button>
                </span>
            </div>
        </li>
    );
}
