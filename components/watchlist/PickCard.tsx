'use client';

import { useId, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ChevronDown, Clock, ExternalLink, MoreHorizontal, Pin, PinOff, Plus, X } from "lucide-react";
import ChangePill from "@/components/ChangePill";
import AssetLogo from "@/components/AssetLogo";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { Level, Pick, Sourced } from "@/lib/domain/types";
import { cn } from "@/lib/utils";
import { formatNumber, formatPercent } from "@/i18n/format";
import {
    FACTOR_KEYS, factorShort, signalLabel,
    formatSignal, formatTime, isStale, kindLabel, signedPct, staleSummary, type SignalKey, type WatchlistRulesView,
} from "./format";
import { EsgChip, Mark, SourceLine, Sparkline, StaleChip } from "./parts";
import type { MarkOf } from "./sources";

type Props = {
    pick: Pick;
    level: Level;
    pinned: boolean;
    busy: boolean;
    compact: boolean;
    rules: WatchlistRulesView;
    ruleVersions: Record<string, string>;
    markOf: MarkOf;
    onWhy: () => void;
    onTrade: () => void;
    onPin: () => void;
    onDismiss: () => void;
};

type Fold = 'factors' | 'raw' | 'freshness';

type Pick2<T, K extends keyof T> = { [P in K]: T[P] };

const ONE_DECIMAL = { minimumFractionDigits: 1, maximumFractionDigits: 1 };

/** Raw values folded on the card, each with its source marker; their exact times are in the freshness section. */
export const CARD_VALUE_KEYS: SignalKey[] = ['price', 'changePercent', 'pe', 'revenueGrowthPct', 'volatility1y', 'beta', 'marketCapUsd', 'avgDailyTradedValueUsd', 'newsCount7d', 'closes1m'];

/** pin / dismiss / open the stock page, behind one "..." button */
function CardMenu({ pick, pinned, busy, onPin, onDismiss, onTrade }: Pick2<Props, 'pick' | 'pinned' | 'busy' | 'onPin' | 'onDismiss'> & { onTrade?: () => void }) {
    const t = useTranslations('Watchlist');
    return (
        <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
                <button type="button" className="icon-btn" aria-label={t('card.more', { name: pick.name })} title={t('card.moreShort')}>
                    <MoreHorizontal aria-hidden />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52">
                {onTrade && <DropdownMenuItem onSelect={onTrade}><Plus aria-hidden />{t('card.addToPortfolio')}</DropdownMenuItem>}
                <DropdownMenuItem disabled={busy} onSelect={onPin}>
                    {pinned ? <PinOff aria-hidden /> : <Pin aria-hidden />}{pinned ? t('card.unpin') : t('card.pin')}
                </DropdownMenuItem>
                <DropdownMenuItem disabled={busy} onSelect={onDismiss}><X aria-hidden />{t('card.dismiss')}</DropdownMenuItem>
                <DropdownMenuItem asChild>
                    <Link href={`/stocks/${encodeURIComponent(pick.symbol)}`}><ExternalLink aria-hidden />{t('card.openPage')}</Link>
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

/** One ranked card. The ranking is the same at every level; only how much of it is shown unfolded changes. */
export default function PickCard({ pick, level, pinned, busy, compact, rules, ruleVersions, markOf, onWhy, onTrade, onPin, onDismiss }: Props) {
    const t = useTranslations('Watchlist');
    const locale = useLocale();
    const foldId = useId();
    const [open, setOpen] = useState<Fold | null>(null);
    const { signals } = pick;
    const move = signals.changePercent?.value;
    const stale = staleSummary(signals, rules.quoteStaleSeconds);
    const quote = signals.price ?? signals.changePercent;
    const quoteTime = quote?.fetchedAt;
    const novice = level === 'Novice';
    const kind = kindLabel(t, pick.assetClass, pick.sector);
    // The reason, or sector and move when no template applied
    const fact = pick.reason?.text
        ?? (move != null ? t('card.factWithMove', { kind: pick.sector ?? kindLabel(t, pick.assetClass), change: signedPct(move, locale) }) : (pick.sector ?? kindLabel(t, pick.assetClass)));
    const staleTitle = [stale.quote && quoteTime ? t('card.staleQuote', { time: formatTime(quoteTime, t, locale) }) : null, stale.daily ? t('card.staleDaily') : null].filter(Boolean).join(' · ');
    const price = <>{formatSignal('price', signals.price, t, locale)}<Mark mark={markOf(signals.price)} sourced={signals.price} /></>;
    const change = move != null
        ? <span className="inline-flex items-center"><ChangePill value={move} /><Mark mark={markOf(signals.changePercent)} sourced={signals.changePercent} /></span>
        : <span className="pill">{t('card.moveNotAvailable')}</span>;
    const score = <span className="num font-bold text-foreground">{formatNumber(pick.total, locale, ONE_DECIMAL)}</span>;

    if (compact) {
        return (
            <li className="@container card min-w-0 px-3 py-2"><div className="flex min-w-0 items-center gap-2.5">
                <AssetLogo symbol={pick.symbol} name={pick.name} assetClass={pick.assetClass} size={28} />
                <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-bold text-foreground" title={`${pick.name} (${pick.symbol})`}>
                        {!novice && <span className="num me-1.5 text-faint" aria-label={t('card.rank', { rank: pick.rank })}>{pick.rank}</span>}
                        {pick.name} <span className="mono text-[11.5px] font-semibold text-faint">{pick.symbol}</span>
                        {pinned && <Pin aria-label={t('card.pinnedShort')} className="ms-1 inline size-3 text-brand-ink" />}
                    </p>
                    <p className="hidden truncate text-[11.5px] text-faint @md:block">{kind}</p>
                </div>
                {(stale.quote || stale.daily) && <span role="img" aria-label={staleTitle} title={staleTitle} className="flex-none text-warn"><Clock aria-hidden className="size-3.5" /></span>}
                <span className="num hidden flex-none text-[13px] font-semibold text-foreground @sm:inline">{price}</span>
                <span className="flex-none">{change}</span>
                {!novice && <span className="hidden flex-none text-[12.5px] text-muted-foreground @md:inline" title={t('card.score')}>{score}<span className="text-faint">{t('card.outOf')}</span></span>}
                <button type="button" className="btn btn-ghost h-8 flex-none px-2.5 text-[12.5px]" onClick={onWhy}>{t('card.why')}</button>
                <CardMenu pick={pick} pinned={pinned} busy={busy} onPin={onPin} onDismiss={onDismiss} onTrade={onTrade} />
                </div>
            </li>
        );
    }

    const folds: Fold[] = novice ? ['raw', 'freshness'] : ['factors', 'raw', 'freshness'];

    return (
        <li className="@container card flex min-w-0 flex-col gap-3 p-4">
            <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                    <AssetLogo symbol={pick.symbol} name={pick.name} assetClass={pick.assetClass} size={38} />
                    <div className="min-w-0">
                        <h3 className="truncate text-[15px] font-bold text-foreground" title={pick.name}>
                            {pick.name}{' '}
                            <span className="mono text-[12.5px] font-semibold text-faint">({pick.symbol})</span>
                        </h3>
                        <p className="truncate text-[12.5px] text-faint">{pinned ? t('card.kindPinned', { kind }) : kind}</p>
                    </div>
                </div>
                <div className="flex flex-none flex-col items-end gap-1">
                    <span className="num text-[14px] font-bold text-foreground">{price}</span>
                    {change}
                </div>
            </div>

            {!novice && (
                <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-muted-foreground">
                    <span className="num pill" aria-label={t('card.rank', { rank: pick.rank })}>{t('card.rankShort', { rank: pick.rank })}</span>
                    <span>{t('card.score')} <span className="text-lg">{score}</span> <span className="text-faint">{t('card.outOf')}</span></span>
                </p>
            )}

            {signals.closes1m && signals.closes1m.value.length > 1 && (
                <div className="flex flex-col gap-1">
                    <Sparkline closes={signals.closes1m.value} dates={signals.closes1m.dates} currency={signals.price?.currency} label={t('card.sparklineLabel', { symbol: pick.symbol })} />
                    <span className="text-[11px] text-faint">{t('card.oneMonthShort')}<Mark mark={markOf(signals.closes1m)} sourced={signals.closes1m} /></span>
                </div>
            )}

            <p className="truncate text-sm text-foreground" title={fact}>{fact}</p>

            <div className="flex flex-wrap items-center gap-1.5">
                <EsgChip tag={signals.entry.esg} />
                {/* One short marker; the exact times are in its tooltip and in "Data freshness" */}
                {(stale.quote || stale.daily) && (
                    <span title={staleTitle}>
                        <StaleChip>{stale.quote && stale.daily ? t('card.staleBoth') : stale.quote ? t('card.staleQuoteShort') : t('card.staleDailyShort')}</StaleChip>
                    </span>
                )}
            </div>

            <div className="flex flex-col gap-2">
                <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('card.foldsLabel')}>
                    {folds.map((fold) => (
                        <button
                            key={fold} type="button"
                            className={cn('btn btn-ghost h-7 gap-1 px-2 text-[12px]', open === fold && 'is-on')}
                            aria-expanded={open === fold} aria-controls={`${foldId}-${fold}`}
                            onClick={() => setOpen(open === fold ? null : fold)}
                        >
                            {t(`card.folds.${fold}`)}
                            <ChevronDown aria-hidden className={cn('transition-transform', open === fold && 'rotate-180')} />
                        </button>
                    ))}
                </div>

                {open === 'factors' && (
                    <div id={`${foldId}-factors`} className="flex flex-col gap-2">
                        <dl className="grid grid-cols-2 gap-2">
                            {FACTOR_KEYS.map((key) => (
                                <div key={key} className={cn('min-w-0 rounded-lg bg-hover px-2.5 py-1.5', pick.topDrivers.slice(0, 2).includes(key) && 'ring-1 ring-brand/40')} title={pick.factors[key].detail}>
                                    <dt className="truncate text-[11.5px] text-faint">{factorShort(t, key)} · {formatPercent(rules.weights[key], locale)}</dt>
                                    <dd className="num text-sm font-bold text-foreground">{formatNumber(pick.factors[key].score, locale, ONE_DECIMAL)}{pick.factors[key].noData && <span className="font-normal text-faint">{t('card.noData')}</span>}</dd>
                                </div>
                            ))}
                        </dl>
                        <p className="text-[12px] text-faint">{t('card.topDriversNote', { list: pick.topDrivers.slice(0, 2).map((key) => factorShort(t, key)).join(', ') })}</p>
                        <p className="text-[12.5px] leading-snug text-muted-foreground"><span className="font-semibold">{t('card.peVsSector')}</span> {pick.factors.fundamentals.detail}</p>
                        <p className="mono break-words text-[11.5px] text-faint">{t('card.ruleVersions', { list: Object.values(ruleVersions).join(' · ') })}</p>
                    </div>
                )}

                {open === 'raw' && (
                    <dl id={`${foldId}-raw`} className="grid gap-x-4 gap-y-1.5 @md:grid-cols-2">
                        {CARD_VALUE_KEYS.map((key) => {
                            const sourced = signals[key] as Sourced<unknown> | undefined;
                            return (
                                <div key={key} className="flex min-w-0 items-baseline justify-between gap-2 text-[13px]">
                                    <dt className="min-w-0 text-muted-foreground">{signalLabel(t, key)}</dt>
                                    <dd className={cn('num flex-none text-end font-semibold', sourced ? 'text-foreground' : 'text-faint')}>{formatSignal(key, sourced, t, locale)}<Mark mark={markOf(sourced)} sourced={sourced} /></dd>
                                </div>
                            );
                        })}
                    </dl>
                )}

                {open === 'freshness' && (
                    <ul id={`${foldId}-freshness`} className="flex flex-col gap-1.5">
                        {CARD_VALUE_KEYS.map((key) => {
                            const sourced = signals[key] as Sourced<unknown> | undefined;
                            if (!sourced) return null;
                            return (
                                <li key={key} className="flex min-w-0 flex-col text-[12.5px]">
                                    <span className="text-muted-foreground">{signalLabel(t, key)}<Mark mark={markOf(sourced)} /></span>
                                    <SourceLine sourced={sourced} stale={isStale(key, sourced, rules.quoteStaleSeconds)} />
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>

            <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-line pt-3">
                <button type="button" className="btn btn-ghost h-9" onClick={onWhy}>{t('card.why')}</button>
                <button type="button" className="btn btn-primary h-9" onClick={onTrade}><Plus aria-hidden />{t('card.addToPortfolio')}</button>
                <span className="ms-auto"><CardMenu pick={pick} pinned={pinned} busy={busy} onPin={onPin} onDismiss={onDismiss} /></span>
            </div>
        </li>
    );
}
