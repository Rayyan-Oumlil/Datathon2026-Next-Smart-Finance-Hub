'use client';

import { useId, useState } from "react";
import { Clock } from "lucide-react";
import { sourceLabel } from "@/lib/source-label";
import { useLocale, useTranslations } from "next-intl";
import type { EsgTag, Sourced } from "@/lib/domain/types";
import { cn } from "@/lib/utils";
import { formatDateTime, formatNumber } from "@/i18n/format";
import { esgLabel, formatTime } from "./format";
import type { SourceLegendEntry } from "./sources";

/** Geometry of the sparkline in a 0-100 box: x and y in percent, y measured from the top. Pure, so it can be tested. */
export function sparklineModel(closes: number[]) {
    const min = Math.min(...closes), max = Math.max(...closes);
    const span = max - min || 1;
    const padY = 8; // percent kept free above and below the line
    const points = closes.map((c, i) => ({
        x: (i / (closes.length - 1)) * 100,
        y: closes.length < 2 || max === min ? 50 : 100 - padY - ((c - min) / span) * (100 - 2 * padY),
    }));
    return { min, max, points, up: closes[closes.length - 1] >= closes[0] };
}

/**
 * 1-month closes as an area line with the last point marked and a hover / touch read-out. Uses only the closes
 * (and their dates when the run has them): no value is added. Rendered only when there are closes.
 */
export function Sparkline({ closes, dates, label, currency }: { closes: number[]; dates?: string[]; label: string; currency?: string }) {
    const t = useTranslations('Watchlist');
    const locale = useLocale();
    const gradientId = useId();
    const [hover, setHover] = useState<number | null>(null);
    if (closes.length < 2) return null;

    const { points, min, max, up } = sparklineModel(closes);
    const line = points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
    const area = `0,100 ${line} 100,100`;
    const first = closes[0], last = closes[closes.length - 1];
    const active = hover ?? closes.length - 1;
    const fmt = (v: number) => formatNumber(v, locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const dateAt = (i: number) => (dates && dates.length === closes.length ? dates[i] : null);
    const pctAt = ((closes[active] - first) / first) * 100;

    function move(event: React.PointerEvent<HTMLDivElement>) {
        const box = event.currentTarget.getBoundingClientRect();
        const ratio = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
        setHover(Math.round(ratio * (closes.length - 1)));
    }

    return (
        <div className={cn('w-full', up ? 'text-up' : 'text-down')}>
            <div className="flex items-baseline justify-between gap-2 text-[11.5px] text-faint">
                <span className="num">{t('card.sparkRange', { low: fmt(min), high: fmt(max) })}</span>
                <span className="num font-semibold" aria-live="off">
                    {dateAt(active) ? t('card.sparkTip', { date: dateAt(active) ?? '', value: `${fmt(closes[active])}${currency ? ` ${currency}` : ''}` }) : `${fmt(closes[active])}${currency ? ` ${currency}` : ''}`}
                    {' '}<span className="text-current">{pctAt >= 0 ? '+' : ''}{formatNumber(pctAt, locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</span>
                </span>
            </div>
            <div className="relative mt-1 h-14 touch-none" onPointerMove={move} onPointerDown={move} onPointerLeave={() => setHover(null)}>
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={label} className="absolute inset-0 h-full w-full overflow-visible">
                    <defs>
                        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
                            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
                        </linearGradient>
                    </defs>
                    <polygon points={area} fill={`url(#${gradientId})`} />
                    {/* The first close, as a dashed baseline, so up or down for the month reads at a glance */}
                    <line x1="0" x2="100" y1={points[0].y} y2={points[0].y} stroke="currentColor" strokeOpacity="0.3" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
                    <polyline points={line} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                    {hover !== null && <line x1={points[hover].x} x2={points[hover].x} y1="0" y2="100" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
                </svg>
                <span aria-hidden className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current ring-2 ring-card" style={{ left: `${points[active].x}%`, top: `${points[active].y}%` }} />
            </div>
        </div>
    );
}

// The ESG tag is hand-set mock data: it never appears without its "demo data" label.
export function EsgChip({ tag }: { tag: EsgTag }) {
    const t = useTranslations('Watchlist');
    return <span className="pill" title={t('esgChip.title')}>{t('esgChip.label', { tag: esgLabel(t, tag) })}</span>;
}

export function StaleChip({ children }: { children: React.ReactNode }) {
    return <span className="pill text-warn"><Clock aria-hidden />{children}</span>;
}

/** Where and when a value came from. Shown in the folded "Data freshness" section of a card and in the "Why?" panel. */
export function SourceLine({ sourced, stale, label }: { sourced: Sourced<unknown>; stale?: boolean; label?: string }) {
    const t = useTranslations('Watchlist');
    const locale = useLocale();
    return (
        <span className="text-[11.5px] leading-snug text-faint">
            {label && t('source.labelled', { label })}
            {t('source.line', {
                source: sourceLabel(sourced.source, locale),
                time: formatTime(sourced.fetchedAt, t, locale),
                hasProvider: String(Boolean(sourced.asOf)),
                providerTime: sourced.asOf ? formatTime(sourced.asOf, t, locale) : '',
            })}
            {stale && <span className="font-bold text-warn">{t('source.stale')}</span>}
        </span>
    );
}

/** A source marker next to a figure; the exact source and time are in the tooltip. */
export function Mark({ mark, sourced }: { mark: string | null; sourced?: Sourced<unknown> }) {
    const t = useTranslations('Watchlist');
    const locale = useLocale();
    if (!mark) return null;
    const title = sourced
        ? t('source.line', {
            source: sourceLabel(sourced.source, locale),
            time: formatTime(sourced.fetchedAt, t, locale),
            hasProvider: String(Boolean(sourced.asOf)),
            providerTime: sourced.asOf ? formatTime(sourced.asOf, t, locale) : '',
        })
        : undefined;
    return <sup className="mono ms-0.5 text-[10px] font-semibold text-faint" title={title}>{mark}</sup>;
}

/** The one place a view names its sources: each once, with the range of fetch times of the values shown. */
export function SourceLegend({ entries }: { entries: SourceLegendEntry[] }) {
    const t = useTranslations('Watchlist');
    const locale = useLocale();
    if (entries.length === 0) return null;
    const day = (iso: string) => formatDateTime(iso, locale, { dateStyle: 'short' });
    const at = (iso: string) => formatDateTime(iso, locale, { dateStyle: 'medium', timeStyle: 'short' });
    const range = (e: SourceLegendEntry) => {
        if (e.from === e.to || at(e.from) === at(e.to)) return t('legend.single', { time: at(e.from) });
        const to = day(e.from) === day(e.to) ? formatDateTime(e.to, locale, { timeStyle: 'short' }) : at(e.to);
        return t('legend.range', { from: at(e.from), to });
    };
    return (
        <div role="note" className="px-1 text-[11.5px] leading-relaxed text-faint">
            <span className="font-semibold text-muted-foreground">{t('legend.title')}</span>{' '}
            {entries.map((e) => (
                <span key={e.source} className="me-3 inline-block">
                    <span className="mono font-semibold">{e.mark}</span> {sourceLabel(e.source, locale)} · {range(e)}
                </span>
            ))}
            <span className="block">{t('legend.note')}</span>
        </div>
    );
}
