import { Clock } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { EsgTag, Sourced } from "@/lib/domain/types";
import { esgLabel, formatTime } from "./format";

/** 1-month closes as a line. Rendered only when there are closes; the caller omits it otherwise. */
export function Sparkline({ closes, label }: { closes: number[]; label: string }) {
    if (closes.length < 2) return null;
    const w = 120, h = 36, pad = 2;
    const min = Math.min(...closes), max = Math.max(...closes);
    const span = max - min || 1;
    const points = closes.map((c, i) => `${(pad + (i / (closes.length - 1)) * (w - 2 * pad)).toFixed(1)},${(h - pad - ((c - min) / span) * (h - 2 * pad)).toFixed(1)}`).join(' ');
    const up = closes[closes.length - 1] >= closes[0];
    return (
        <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={label} className={up ? 'text-up' : 'text-down'}>
            <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
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

/** Where and when a value came from. Shown next to every figure on the Expert card and in the "Why?" panel. */
export function SourceLine({ sourced, stale, label }: { sourced: Sourced<unknown>; stale?: boolean; label?: string }) {
    const t = useTranslations('Watchlist');
    const locale = useLocale();
    return (
        <span className="text-[11.5px] leading-snug text-faint">
            {label && t('source.labelled', { label })}
            {t('source.line', {
                source: sourced.source,
                time: formatTime(sourced.fetchedAt, t, locale),
                hasProvider: String(Boolean(sourced.asOf)),
                providerTime: sourced.asOf ? formatTime(sourced.asOf, t, locale) : '',
            })}
            {stale && <span className="font-bold text-warn">{t('source.stale')}</span>}
        </span>
    );
}
