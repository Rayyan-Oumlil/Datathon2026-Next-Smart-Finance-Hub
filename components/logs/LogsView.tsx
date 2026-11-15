'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Copy, Download, RefreshCw } from 'lucide-react';
import { formatDateTime, formatNumber } from '@/i18n/format';
import { cn } from '@/lib/utils';
import type { AgentActionLogEntry, DecisionLogEntry } from '@/lib/domain/types';

type Tab = 'agent' | 'decisions';
type Generation = { profile: number; portfolio: number; scopeId: string; current: boolean; since: string | null; until: string | null };

const KINDS = ['watchlist_run', 'pick', 'user_action', 'simulated_trade', 'profile_conflict', 'profile_change', 'session_reset'] as const;

/** Downloads the rows shown, as they came from the API. */
function downloadJson(name: string, data: unknown) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const CopyCommand = ({ id }: { id: string }) => {
    const t = useTranslations('Logs');
    const [copied, setCopied] = useState(false);
    const command = `infra/lookup-call.sh ${id}`;
    return (
        <div className="mt-1">
            <span className="block text-[11px] font-semibold text-faint">{t('cloudTrail')}</span>
            <span className="inline-flex max-w-full items-center gap-1">
                <code className="mono break-all rounded bg-hover px-1 py-0.5 text-[11px]">{command}</code>
                <button type="button" className="icon-btn h-6 w-6 flex-none" aria-label={t('copy')} title={copied ? t('copied') : t('copy')}
                    onClick={() => { void navigator.clipboard?.writeText(command).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>
                    <Copy className="h-3 w-3" aria-hidden />
                </button>
                {copied && <span className="text-[11px] text-up" aria-live="polite">{t('copied')}</span>}
            </span>
        </div>
    );
};

const RawRow = ({ row }: { row: unknown }) => {
    const t = useTranslations('Logs');
    return (
        <details className="mt-1">
            <summary className="cursor-pointer select-none text-[11px] font-semibold text-faint hover:text-foreground">{t('showRow')}</summary>
            <pre className="mono mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded bg-hover p-2 text-[11px]">{JSON.stringify(row, null, 2)}</pre>
        </details>
    );
};

// The raw journals of this visitor: the agent action log (filter by actionId) and the decision log (filter by kind),
// for the current generation or an earlier one. Nothing here writes.
const LogsView = ({ initialActionId, initialTab }: { initialActionId: string; initialTab: Tab }) => {
    const t = useTranslations('Logs');
    const ta = useTranslations('AgentPanel');
    const locale = useLocale();
    const router = useRouter();
    const [tab, setTab] = useState<Tab>(initialTab);
    const [actionId, setActionId] = useState(initialActionId);
    const [draft, setDraft] = useState(initialActionId);
    const [kind, setKind] = useState('');
    const [generations, setGenerations] = useState<Generation[]>([]);
    const [generation, setGeneration] = useState('');              // 'p/f'; '' = current
    const [agentRows, setAgentRows] = useState<AgentActionLogEntry[] | null>(null);
    const [decisions, setDecisions] = useState<DecisionLogEntry[] | null>(null);
    const [error, setError] = useState(false);

    useEffect(() => {
        fetch('/api/logs/generations', { cache: 'no-store' }).then((r) => r.json()).then((data) => setGenerations(data.generations ?? [])).catch(() => setGenerations([]));
    }, []);

    const load = useCallback(async () => {
        setError(false);
        const params = new URLSearchParams({ table: tab });
        if (generation) { const [p, f] = generation.split('/'); params.set('p', p); params.set('f', f); }
        if (tab === 'agent' && actionId) params.set('actionId', actionId);
        if (tab === 'decisions' && kind) params.set('kind', kind);
        if (tab === 'agent') setAgentRows(null); else setDecisions(null);
        try {
            const response = await fetch(`/api/logs?${params}`, { cache: 'no-store' });
            const data = await response.json();
            if (!response.ok) throw new Error(data?.error);
            if (tab === 'agent') setAgentRows(data.rows ?? []); else setDecisions(data.decisions ?? []);
        } catch {
            setError(true);
            if (tab === 'agent') setAgentRows([]); else setDecisions([]);
        }
    }, [tab, generation, actionId, kind]);

    useEffect(() => { void load(); }, [load]);

    // The filter lives in the address too, so a timeline link and a copied address show the same rows
    const applyActionId = (value: string) => {
        const next = value.trim().slice(0, 60);
        setActionId(next);
        setDraft(next);
        router.replace(next ? `/logs?actionId=${encodeURIComponent(next)}` : '/logs', { scroll: false });
    };

    const rows = tab === 'agent' ? agentRows : decisions;
    const none = t('none');
    const stepLabel = (step: string) => (ta.has(`trace.steps.${step}` as never) ? ta(`trace.steps.${step}` as never) : step);
    const actorLabel = (actor: string) => actor.startsWith('subagent:')
        ? ta('trace.actors.subagent', { name: actor.slice('subagent:'.length) })
        : ta.has(`trace.actors.${actor}` as never) ? ta(`trace.actors.${actor}` as never) : actor;
    const time = (iso: string) => formatDateTime(iso, locale, { dateStyle: 'short', timeStyle: 'medium' });
    const genLabel = (g: Generation) => g.current
        ? t('generation.current', { profile: g.profile, portfolio: g.portfolio })
        : g.until ? t('generation.earlier', { profile: g.profile, portfolio: g.portfolio, until: time(g.until) }) : t('generation.earlierOpen', { profile: g.profile, portfolio: g.portfolio });

    return (
        <section className="hatch">
            <div className="card flex flex-col gap-3">
                <div className="flex flex-wrap items-end gap-3">
                    <div role="tablist" aria-label={t('tabs.label')} className="flex gap-1">
                        {(['agent', 'decisions'] as const).map((id) => (
                            <button key={id} type="button" role="tab" aria-selected={tab === id} className={cn('btn btn-ghost h-8 px-2.5 text-xs', tab === id && 'is-on')} onClick={() => setTab(id)}>
                                {t(`tabs.${id}`)}
                            </button>
                        ))}
                    </div>
                    {generations.length > 1 && (
                        <label className="flex flex-col gap-0.5 text-xs">
                            <span className="form-label">{t('generation.label')}</span>
                            <select className="h-8 rounded-lg border border-line bg-canvas px-2 text-xs text-foreground" value={generation} onChange={(e) => setGeneration(e.target.value)} title={t('generation.note')}>
                                {generations.map((g) => (
                                    <option key={g.scopeId} value={g.current ? '' : `${g.profile}/${g.portfolio}`}>{genLabel(g)}</option>
                                ))}
                            </select>
                        </label>
                    )}
                    {tab === 'agent' ? (
                        <form className="flex items-end gap-1.5" onSubmit={(e) => { e.preventDefault(); applyActionId(draft); }}>
                            <label className="flex flex-col gap-0.5 text-xs">
                                <span className="form-label">{t('filter.actionId')}</span>
                                <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t('filter.actionIdPlaceholder')} maxLength={60}
                                    className="mono h-8 w-56 rounded-lg border border-line bg-canvas px-2 text-xs text-foreground placeholder:text-faint" />
                            </label>
                            <button type="submit" className="btn btn-ghost h-8 px-2.5 text-xs">{t('filter.apply')}</button>
                            {actionId && <button type="button" className="btn btn-ghost h-8 px-2.5 text-xs" onClick={() => applyActionId('')}>{t('filter.clear')}</button>}
                        </form>
                    ) : (
                        <label className="flex flex-col gap-0.5 text-xs">
                            <span className="form-label">{t('filter.kind')}</span>
                            <select className="h-8 rounded-lg border border-line bg-canvas px-2 text-xs text-foreground" value={kind} onChange={(e) => setKind(e.target.value)}>
                                <option value="">{t('filter.allKinds')}</option>
                                {KINDS.map((k) => <option key={k} value={k}>{t(`filter.kinds.${k}`)}</option>)}
                            </select>
                        </label>
                    )}
                    <div className="ms-auto flex gap-1.5">
                        <button type="button" className="btn btn-ghost h-8 px-2.5 text-xs" onClick={() => void load()}><RefreshCw className="h-3.5 w-3.5" aria-hidden /> {t('reload')}</button>
                        <button type="button" className="btn btn-ghost h-8 px-2.5 text-xs" disabled={!rows || rows.length === 0}
                            onClick={() => downloadJson(`${tab === 'agent' ? 'agent_action_log' : 'decision_log'}${tab === 'agent' && actionId ? `-${actionId}` : ''}.json`, rows)}>
                            <Download className="h-3.5 w-3.5" aria-hidden /> {t('export')}
                        </button>
                    </div>
                </div>

                <p className="text-xs text-faint" aria-live="polite">
                    {rows === null ? t('loading') : error ? t('error') : rows.length === 0 ? t('empty') : t('count', { count: rows.length })}
                </p>

                {tab === 'agent' && agentRows && agentRows.length > 0 && (
                    <div className="overflow-x-auto">
                        <table className="w-full text-start text-xs">
                            <thead className="text-faint">
                                <tr className="border-b border-line">
                                    {(['time', 'actionId', 'step', 'actor', 'model', 'awsRequestId', 'tokens'] as const).map((c) => <th key={c} scope="col" className="px-2 py-1.5 text-start font-semibold">{t(`columns.${c}`)}</th>)}
                                </tr>
                            </thead>
                            <tbody>
                                {agentRows.map((row) => (
                                    <tr key={row.id} className={cn('border-b border-line align-top', row.step === 'error' && 'bg-down-soft')}>
                                        <td className="num whitespace-nowrap px-2 py-1.5">{time(row.at)}</td>
                                        <td className="px-2 py-1.5">
                                            <button type="button" className="mono text-brand-ink hover:underline" title={t('filterThis')} onClick={() => applyActionId(row.actionId)}>{row.actionId}</button>
                                        </td>
                                        <td className="px-2 py-1.5">
                                            <span className="font-semibold text-foreground">{stepLabel(row.step)}</span>
                                            <span className="mono block text-[11px] text-faint">{row.step}</span>
                                            <RawRow row={row} />
                                        </td>
                                        <td className="px-2 py-1.5">{actorLabel(row.actor)}</td>
                                        <td className="mono px-2 py-1.5 break-all">{row.modelId ?? none}</td>
                                        <td className="px-2 py-1.5">
                                            {row.awsRequestId ? <><span className="mono break-all">{row.awsRequestId}</span><CopyCommand id={row.awsRequestId} /></> : none}
                                        </td>
                                        <td className="num whitespace-nowrap px-2 py-1.5">
                                            {row.inputTokens === undefined && row.outputTokens === undefined ? none
                                                : `${row.inputTokens === undefined ? none : formatNumber(row.inputTokens, locale)} / ${row.outputTokens === undefined ? none : formatNumber(row.outputTokens, locale)}`}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {tab === 'decisions' && decisions && decisions.length > 0 && (
                    <div className="overflow-x-auto">
                        <table className="w-full text-start text-xs">
                            <thead className="text-faint">
                                <tr className="border-b border-line">
                                    {(['time', 'kind', 'symbol', 'details'] as const).map((c) => <th key={c} scope="col" className="px-2 py-1.5 text-start font-semibold">{t(`columns.${c}`)}</th>)}
                                </tr>
                            </thead>
                            <tbody>
                                {decisions.map((row) => (
                                    <tr key={`${row.userId}#${row.id}`} className="border-b border-line align-top">
                                        <td className="num whitespace-nowrap px-2 py-1.5">{time(row.at)}</td>
                                        <td className="px-2 py-1.5">
                                            <span className="font-semibold text-foreground">{t.has(`filter.kinds.${row.kind}` as never) ? t(`filter.kinds.${row.kind}` as never) : row.kind}</span>
                                            <span className="mono block text-[11px] text-faint">{row.kind}</span>
                                        </td>
                                        <td className="mono px-2 py-1.5">{row.symbol ?? none}</td>
                                        <td className="px-2 py-1.5"><RawRow row={row} /></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </section>
    );
};

export default LogsView;
