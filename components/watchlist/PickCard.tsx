'use client';

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Pin, PinOff, Plus, X } from "lucide-react";
import ChangePill from "@/components/ChangePill";
import type { Level, Pick, Sourced } from "@/lib/domain/types";
import { cn } from "@/lib/utils";
import { formatNumber, formatPercent } from "@/i18n/format";
import {
    FACTOR_KEYS, factorShort, signalLabel,
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

const ONE_DECIMAL = { minimumFractionDigits: 1, maximumFractionDigits: 1 };

// Raw values on the Expert card, each with its source and fetch time
const EXPERT_ROWS: SignalKey[] = ['price', 'changePercent', 'pe', 'revenueGrowthPct', 'volatility1y', 'beta', 'marketCapUsd', 'avgDailyTradedValueUsd', 'newsCount7d'];

/** One ranked card. The ranking is the same at every level; only how much of it is shown changes. */
export default function PickCard({ pick, level, pinned, busy, rules, ruleVersions, onWhy, onTrade, onPin, onDismiss }: Props) {
    const t = useTranslations('Watchlist');
    const locale = useLocale();
    const { signals } = pick;
    const move = signals.changePercent?.value;
    const stale = staleSummary(signals, rules.quoteStaleSeconds);
    const quote = signals.price ?? signals.changePercent;
    const quoteTime = quote?.fetchedAt;
    const novice = level === 'Novice';
    const expert = level === 'Expert';
    // Novice sentence: the reason, or sector and move when no template applied
    const fact = pick.reason?.text
        ?? (move != null ? t('card.factWithMove', { kind: pick.sector ?? kindLabel(t, pick.assetClass), change: signedPct(move, locale) }) : (pick.sector ?? kindLabel(t, pick.assetClass)));

    return (
        <li className="card flex flex-col gap-3 p-4">
            <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                    {!novice && <span className="num grid size-8 flex-none place-items-center rounded-full bg-brand-soft text-[13px] font-bold text-brand-ink" aria-label={t('card.rank', { rank: pick.rank })}>{pick.rank}</span>}
                    <div className="min-w-0">
                        <h3 className="truncate text-[15px] font-bold text-foreground">
                            <Link href={`/stocks/${encodeURIComponent(pick.symbol)}`} className="hover:underline focus-visible:underline">{pick.name}</Link>{' '}
                            <span className="mono text-[12.5px] font-semibold text-faint">({pick.symbol})</span>
                        </h3>
                        <p className="text-[12.5px] text-faint">{pinned ? t('card.kindPinned', { kind: kindLabel(t, pick.assetClass, pick.sector) }) : kindLabel(t, pick.assetClass, pick.sector)}</p>
                    </div>
                </div>
                <div className="flex flex-none flex-col items-end gap-1">
                    {move != null ? <ChangePill value={move} /> : <span className="pill">{t('card.moveNotAvailable')}</span>}
                    {!novice && <span className="num text-[13px] font-semibold text-foreground">{formatSignal('price', signals.price, t, locale)}</span>}
                </div>
            </div>

            <p className="text-sm text-foreground">{fact}</p>
            {/* The Expert card lists every value with its source below; the other levels still say where the quote is from */}
            {!expert && quote && <p><SourceLine sourced={quote} label={t('card.quote')} /></p>}

            {!novice && (
                <div className="flex flex-wrap items-end justify-between gap-3">
                    <div className="flex flex-col gap-1.5">
                        <p className="text-sm text-muted-foreground">{t('card.score')} <span className="num text-lg font-bold text-foreground">{formatNumber(pick.total, locale, ONE_DECIMAL)}</span> <span className="text-faint">{t('card.outOf')}</span></p>
                        {!expert && (
                            <p className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-faint">
                                {t('card.topDrivers')}
                                {pick.topDrivers.slice(0, 2).map((key) => <span key={key} className="pill">{factorShort(t, key)} <span className="num">{formatNumber(pick.factors[key].score, locale, { maximumFractionDigits: 0 })}</span></span>)}
                            </p>
                        )}
                    </div>
                    {signals.closes1m && signals.closes1m.value.length > 1 && (
                        <div className="flex flex-col items-end">
                            <Sparkline closes={signals.closes1m.value} label={t('card.sparklineLabel', { symbol: pick.symbol })} />
                            <span className="text-[11px] text-faint">{t('card.oneMonth', { source: signals.closes1m.source })}</span>
                        </div>
                    )}
                </div>
            )}

            {expert && (
                <>
                    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {FACTOR_KEYS.map((key) => (
                            <div key={key} className="rounded-lg bg-hover px-2.5 py-1.5" title={pick.factors[key].detail}>
                                <dt className="text-[11.5px] text-faint">{factorShort(t, key)} · {formatPercent(rules.weights[key], locale)}</dt>
                                <dd className="num text-sm font-bold text-foreground">{formatNumber(pick.factors[key].score, locale, ONE_DECIMAL)}{pick.factors[key].noData && <span className="font-normal text-faint">{t('card.noData')}</span>}</dd>
                            </div>
                        ))}
                    </dl>
                    <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
                        {EXPERT_ROWS.map((key) => {
                            const sourced = signals[key] as Sourced<unknown> | undefined;
                            return (
                                <div key={key} className="min-w-0">
                                    <div className="flex items-baseline justify-between gap-2 text-[13px]">
                                        <dt className="text-muted-foreground">{signalLabel(t, key)}</dt>
                                        <dd className={cn('num font-semibold', sourced ? 'text-foreground' : 'text-faint')}>{formatSignal(key, sourced, t, locale)}</dd>
                                    </div>
                                    {sourced && <SourceLine sourced={sourced} stale={isStale(key, sourced, rules.quoteStaleSeconds)} />}
                                </div>
                            );
                        })}
                    </dl>
                    <p className="text-[12.5px] leading-snug text-muted-foreground"><span className="font-semibold">{t('card.peVsSector')}</span> {pick.factors.fundamentals.detail}</p>
                    <p className="mono text-[11.5px] text-faint">{Object.values(ruleVersions).join(' · ')}</p>
                </>
            )}

            <div className="flex flex-wrap items-center gap-1.5">
                <EsgChip tag={signals.entry.esg} />
                {stale.quote && quoteTime && <StaleChip>{t('card.staleQuote', { time: formatTime(quoteTime, t, locale) })}</StaleChip>}
                {stale.daily && <StaleChip>{t('card.staleDaily')}</StaleChip>}
            </div>

            <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-line pt-3">
                <button type="button" className="btn btn-ghost h-9" onClick={onWhy}>{t('card.why')}</button>
                <button type="button" className="btn btn-primary h-9" onClick={onTrade}><Plus aria-hidden />{t('card.addToPortfolio')}</button>
                <span className="ms-auto flex gap-1">
                    <button type="button" className={cn('btn btn-ghost h-9 px-2.5', pinned && 'is-on')} aria-pressed={pinned} disabled={busy} onClick={onPin}>
                        {pinned ? <PinOff aria-hidden /> : <Pin aria-hidden />}{pinned ? t('card.unpin') : t('card.pin')}
                    </button>
                    <button type="button" className="btn btn-ghost h-9 px-2.5" disabled={busy} onClick={onDismiss}><X aria-hidden />{t('card.dismiss')}</button>
                </span>
            </div>
        </li>
    );
}
