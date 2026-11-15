import { Clock } from "lucide-react";
import type { EsgTag, Sourced } from "@/lib/domain/types";
import { formatTime } from "./format";

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
    return <span className="pill" title="Hand-set tag, not from a data provider">ESG: {tag} · demo data</span>;
}

export function StaleChip({ children }: { children: React.ReactNode }) {
    return <span className="pill text-warn"><Clock aria-hidden />{children}</span>;
}

/** Where and when a value came from. Shown next to every figure on the Expert card and in the "Why?" panel. */
export function SourceLine({ sourced, stale, label }: { sourced: Sourced<unknown>; stale?: boolean; label?: string }) {
    return (
        <span className="text-[11.5px] leading-snug text-faint">
            {label && `${label}: `}{sourced.source} · fetched {formatTime(sourced.fetchedAt)}
            {sourced.asOf && <> · provider time {formatTime(sourced.asOf)}</>}
            {stale && <span className="font-bold text-warn"> · stale</span>}
        </span>
    );
}
