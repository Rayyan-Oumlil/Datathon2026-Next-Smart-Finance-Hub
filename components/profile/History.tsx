'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { DecisionLogEntry, FilterCheck, Sourced } from '@/lib/domain/types';
import Panel from '@/components/Panel';
import { useDataChanged } from '@/hooks/useDataChanged';
import { formatDateTime, formatMoney, formatNumber } from '@/i18n/format';
import { sourceLabel } from '@/lib/source-label';
import { cn } from '@/lib/utils';

const KINDS = [{ kind: 'pick' }, { kind: 'simulated_trade' }, { kind: 'profile_conflict' }] as const;
type Kind = (typeof KINDS)[number]['kind'];

// Only the parts of each logged payload this timeline reads; anything absent is shown as not available.
type PickPayload = { rank?: number; name?: string; total?: number; topDrivers?: string[]; reason?: { text?: string; templateId?: string } | null };
type TradePayload = {
    trade?: { side?: string; quantity?: number; price?: Sourced; valueCad?: number; origin?: string; reason?: string; ruleId?: string };
    conflicts?: FilterCheck[];
    fxUsdCad?: Sourced;
};
type ConflictPayload = { conflicts?: FilterCheck[]; level?: string; risk?: string; proceeded?: boolean };

const DRIVERS = ['profile_fit', 'risk_fit', 'fundamentals', 'diversification'];
const ORIGINS = ['card', 'rule', 'agent'];
const LEVELS = ['Novice', 'Intermediate', 'Expert'];
const RISKS = ['Low', 'Medium', 'High'];

type Translator = (key: string, values?: Record<string, string | number>) => string;

// Everything the timeline writes goes through the Profile namespace and the active locale's number and date formats.
function describe(entry: DecisionLogEntry, t: Translator, locale: string): { tag: string; title: string; why: string; facts: string[] } {
    const h = (key: string, values?: Record<string, string | number>) => t(`history.${key}`, values);
    const NA = h('notAvailable');
    const num = (value: number | undefined, digits = 2) =>
        value === undefined ? NA : formatNumber(value, locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    const when = (iso: string | undefined) => (iso ? formatDateTime(iso, locale) : NA);
    // A level or risk band from the log is shown in words; one this app does not know stays as logged
    const level = (value: string | undefined) => (value === undefined ? NA : LEVELS.includes(value) ? t('level', { level: value }) : value);
    const risk = (value: string | undefined) => (value === undefined ? NA : RISKS.includes(value) ? t('risk', { risk: value }) : value);

    if (entry.kind === 'pick') {
        const p = (entry.payload ?? {}) as PickPayload;
        return {
            tag: h('tags.pick'),
            title: h('pick.title', { subject: `${entry.symbol ?? NA}${p.name ? ` · ${p.name}` : ''}`, rank: p.rank === undefined ? NA : formatNumber(p.rank, locale) }),
            why: p.reason?.text ?? h('pick.noReason'),
            facts: [
                h('pick.score', { score: num(p.total, 1) }),
                ...(p.topDrivers?.length
                    ? [h('pick.factors', { factors: p.topDrivers.map((d) => (DRIVERS.includes(d) ? h(`pick.drivers.${d}`) : d)).join(', ') })]
                    : []),
                ...(p.reason?.templateId ? [h('pick.template', { id: p.reason.templateId })] : []),
            ],
        };
    }
    if (entry.kind === 'simulated_trade') {
        const p = (entry.payload ?? {}) as TradePayload;
        const tr = p.trade ?? {};
        const price = tr.price;
        const fx = p.fxUsdCad;
        const action = tr.side === 'buy' ? h('trade.purchase') : tr.side === 'sell' ? h('trade.reduction') : h('trade.unknown');
        const failed = (p.conflicts ?? []).filter((c) => !c.pass);
        const origin = ORIGINS.includes(tr.origin ?? '') ? h(`trade.origins.${tr.origin}`) : h('trade.origins.unknown');
        return {
            tag: h('tags.simulated_trade'),
            title: h('trade.title', {
                action,
                quantity: num(tr.quantity, 6),
                symbol: entry.symbol ?? NA,
                value: tr.valueCad === undefined ? NA : formatMoney(tr.valueCad, 'CAD', locale),
            }),
            why: tr.ruleId
                ? h('trade.byRule', { ruleId: tr.ruleId })
                : `${h('trade.asked', { origin })}${failed.length ? ` ${h('trade.acknowledged')}` : ''}`,
            facts: [
                price
                    ? `${h('trade.filled', { price: num(price.value), currency: price.currency ?? '', source: price.source ? sourceLabel(price.source, locale) : NA, fetched: when(price.fetchedAt) })}${price.asOf ? h('trade.asOfSuffix', { asOf: when(price.asOf) }) : ''}`
                    : h('trade.noPrice'),
                // The CAD value of a USD fill depends on the day's rate, so the rate is shown with its source
                ...(price?.currency === 'USD'
                    ? [fx
                        ? `${h('trade.converted', { rate: num(fx.value, 4), source: fx.source ? sourceLabel(fx.source, locale) : NA, fetched: when(fx.fetchedAt) })}${fx.asOf ? h('trade.asOfSuffix', { asOf: fx.asOf }) : ''}`
                        : h('trade.noRate')]
                    : []),
                ...(tr.reason ? [h('trade.reason', { reason: tr.reason })] : []),
            ],
        };
    }
    const p = (entry.payload ?? {}) as ConflictPayload;
    const failed = (p.conflicts ?? []).filter((c) => !c.pass);
    return {
        tag: h('tags.profile_conflict'),
        title: h('conflict.title', { symbol: entry.symbol ?? NA, count: failed.length }),
        // The filter sentences are written by the server in the active language; they are shown as received
        why: failed.map((c) => c.detail).join('; ') || h('conflict.noDetails'),
        facts: [
            h('conflict.profileThen', { level: level(p.level), risk: risk(p.risk) }),
            p.proceeded ? h('conflict.proceeded') : h('conflict.notProceeded'),
        ],
    };
}

// Past picks, simulated trades and profile conflicts, read from the append-only decision log.
export default function History() {
    const t = useTranslations('Profile');
    const locale = useLocale();
    const when = (iso: string) => formatDateTime(iso, locale);
    const [entries, setEntries] = useState<DecisionLogEntry[] | null>(null);
    const [failed, setFailed] = useState(false);
    const [reading, setReading] = useState(false);
    const [shown, setShown] = useState<Kind | 'all'>('all');

    // The entries on screen stay while the log is read again: an emptied list would shorten the page under the reader
    const load = useCallback(async () => {
        setFailed(false);
        setReading(true);
        try {
            const lists = await Promise.all(KINDS.map(async ({ kind }) => {
                const res = await fetch(`/api/decisions?kind=${kind}&limit=40`, { cache: 'no-store' });
                if (!res.ok) throw new Error(String(res.status));
                return ((await res.json()) as { decisions: DecisionLogEntry[] }).decisions;
            }));
            setEntries(lists.flat().sort((a, b) => b.id.localeCompare(a.id)));
        } catch {
            setFailed(true);
        } finally {
            setReading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);
    // A change saved by the agent adds entries
    useDataChanged(() => void load());

    const visible = (entries ?? []).filter((entry) => shown === 'all' || entry.kind === shown);

    return (
        <Panel
            title={t('history.title')}
            sub={t('history.subtitle')}
            action={(
                <button type="button" className="btn btn-ghost" disabled={reading} onClick={() => void load()}>
                    <RefreshCw aria-hidden className={cn(reading && 'animate-spin')} /> {t('history.reload')}
                </button>
            )}
            bodyClassName="flex flex-col"
        >
            <div role="group" aria-label={t('history.show')} className="flex flex-wrap gap-1.5 border-b border-line p-3">
                {[{ kind: 'all' as const }, ...KINDS].map(({ kind }) => (
                    <button
                        key={kind}
                        type="button"
                        aria-pressed={shown === kind}
                        onClick={() => setShown(kind)}
                        className={cn('btn btn-ghost h-8 px-3 text-[13px]', shown === kind && 'is-on')}
                    >
                        {t(`history.kinds.${kind}`)}
                    </button>
                ))}
            </div>

            {failed && (
                <div className="empty-state" role="alert">
                    <h3>{t('history.failedTitle')}</h3>
                    <p>{t('history.failedBody')}</p>
                </div>
            )}
            {!failed && entries === null && <p className="p-4 text-[13.5px] text-faint" aria-live="polite">{t('history.reading')}</p>}
            {!failed && entries !== null && visible.length === 0 && (
                <div className="empty-state">
                    <h3>{t('history.emptyTitle')}</h3>
                    <p>{t('history.emptyBody')}</p>
                </div>
            )}

            <ol aria-busy={reading} className={cn('flex flex-col divide-y divide-line transition-opacity', reading && entries !== null && 'opacity-60')}>
                {!failed && visible.map((entry) => {
                    const { tag, title, why, facts } = describe(entry, t, locale);
                    const versions = Object.entries(entry.ruleVersions ?? {});
                    return (
                        <li key={entry.id} className="flex flex-col gap-1.5 px-4 py-3">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                <span className={cn('pill', entry.kind === 'pick' && 'is-brand')}>{tag}</span>
                                <time dateTime={entry.at} className="num text-[12.5px] text-faint">{when(entry.at)}</time>
                            </div>
                            <p className="text-[14.5px] font-semibold text-foreground">{title}</p>
                            <p className="text-[13.5px] text-foreground">{why}</p>
                            <ul className="flex flex-col gap-0.5 text-[12.5px] text-muted-foreground">
                                {facts.map((fact) => <li key={fact}>{fact}</li>)}
                            </ul>
                            <p className="mono break-words text-[11.5px] text-faint">
                                {[
                                    versions.length ? t('history.meta.rules', { versions: versions.map(([, version]) => version).join(' · ') }) : t('history.meta.noRules'),
                                    ...(entry.snapshotId ? [t('history.meta.snapshot', { id: entry.snapshotId })] : []),
                                    t('history.meta.logId', { id: entry.id }),
                                ].join(' · ')}
                            </p>
                        </li>
                    );
                })}
            </ol>
        </Panel>
    );
}
