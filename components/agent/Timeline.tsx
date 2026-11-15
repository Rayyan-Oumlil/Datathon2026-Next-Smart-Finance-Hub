'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, Check, ChevronDown } from 'lucide-react';
import { formatDateTime } from '@/i18n/format';
import { cn } from '@/lib/utils';
import { timelineComplete, timelineFromRows, type TimelineItem, type TimelineRow } from '@/lib/agent/timeline';

type Translator = ReturnType<typeof useTranslations<'AgentPanel'>>;

/** The words of one item: the technical ids in its values (tool, specialist, action type) read in the active language. */
export function timelineText(t: Translator, locale: string, item: TimelineItem): string {
    const values: Record<string, string | number> = { ...item.values, time: formatDateTime(item.at, locale, { timeStyle: 'medium' }) };
    const tool = String(item.values.tool ?? '');
    if (tool && t.has(`timeline.tools.${tool}` as never)) values.tool = t(`timeline.tools.${tool}` as never);
    const agent = String(item.values.agent ?? '');
    if (agent && t.has(`timeline.agents.${agent}` as never)) values.agent = t(`timeline.agents.${agent}` as never);
    if (item.values.type !== undefined) values.type = t('timeline.type', { type: String(item.values.type) });
    return t(`timeline.steps.${item.key}` as never, values as never);
}

const lowerFirst = (text: string) => text.charAt(0).toLocaleLowerCase() + text.slice(1);

// The readable timeline kept with a finished reply: one line by default ("I checked your profile → I looked up the
// prices (MSFT, 14:02) → guardrail: no issue"), every step when expanded. Built from the action-log rows of this
// actionId by lib/agent/timeline.ts, never by a model. `refreshKey` changes when the reply's change is confirmed,
// cancelled or undone, so the new rows are read.
const Timeline = ({ actionId, refreshKey }: { actionId: string; refreshKey?: string }) => {
    const t = useTranslations('AgentPanel');
    const locale = useLocale();
    const [rows, setRows] = useState<TimelineRow[] | null>(null);
    const [error, setError] = useState(false);
    const [open, setOpen] = useState(false);

    const load = useCallback(async (signal?: AbortSignal) => {
        setError(false);
        try {
            const response = await fetch(`/api/agent/log?actionId=${encodeURIComponent(actionId)}`, { cache: 'no-store', signal });
            const data = await response.json();
            if (!response.ok) throw new Error(data?.error);
            return (data.rows ?? []) as TimelineRow[];
        } catch (cause) {
            if (!(cause instanceof DOMException && cause.name === 'AbortError')) setError(true);
            return null;
        }
    }, [actionId]);

    // The log index can lag a few seconds behind the reply: read again a few times until the final row is there
    useEffect(() => {
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const attempt = async (left: number) => {
            const found = await load(controller.signal);
            if (controller.signal.aborted) return;
            if (found) setRows(found);
            if ((!found || !timelineComplete(found)) && left > 0) timer = setTimeout(() => void attempt(left - 1), 1500);
        };
        void attempt(3);
        return () => { controller.abort(); if (timer) clearTimeout(timer); };
    }, [load, refreshKey]);

    const items = useMemo(() => (rows ? timelineFromRows(rows) : []), [rows]);
    const summary = useMemo(() => {
        const shown = items.filter((item) => !item.minor);
        return (shown.length ? shown : items).map((item, index) => {
            const text = timelineText(t, locale, item);
            return index === 0 ? text : lowerFirst(text);
        }).join(' → ');
    }, [items, t, locale]);

    return (
        <div className="mt-2 rounded-lg border border-line text-xs">
            <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
                className="flex w-full items-center gap-1.5 px-2 py-1.5 text-start text-muted-foreground hover:bg-hover"
                title={open ? t('timeline.collapse') : t('timeline.expand')}>
                <ChevronDown className={cn('h-3.5 w-3.5 flex-none transition-transform motion-reduce:transition-none', open && 'rotate-180')} aria-hidden />
                <span className="sr-only">{t('timeline.title')} : </span>
                <span className={cn('min-w-0 flex-1', !open && 'truncate')}>
                    {rows === null ? (error ? t('timeline.unavailable') : t('timeline.loading')) : items.length === 0 ? t('timeline.empty') : summary}
                </span>
            </button>
            {open && (
                <div className="border-t border-line px-2 py-1.5">
                    <p className="kicker">{t('timeline.title')}</p>
                    {items.length > 0 && (
                        <ol className="mt-1 flex flex-col gap-1">
                            {items.map((item) => (
                                <li key={item.id} className={cn('flex items-start gap-1.5', item.failed ? 'text-down' : 'text-foreground')}>
                                    {item.failed
                                        ? <AlertTriangle className="mt-0.5 h-3 w-3 flex-none" aria-hidden />
                                        : <Check className="mt-0.5 h-3 w-3 flex-none text-up" aria-hidden />}
                                    <span className="flex-1">{timelineText(t, locale, item)}</span>
                                    <span className="num flex-none text-[11px] text-faint">{formatDateTime(item.at, locale, { timeStyle: 'medium' })}</span>
                                </li>
                            ))}
                        </ol>
                    )}
                    <p className="mt-1.5 text-faint">{t('timeline.note')}</p>
                    <div className="mt-1 flex flex-wrap gap-x-3">
                        <Link href={`/logs?actionId=${encodeURIComponent(actionId)}`} className="font-semibold text-brand-ink hover:underline">{t('timeline.rawLink')}</Link>
                        <button type="button" className="font-semibold text-brand-ink hover:underline" onClick={() => void load().then((found) => { if (found) setRows(found); })}>{t('timeline.reload')}</button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Timeline;
