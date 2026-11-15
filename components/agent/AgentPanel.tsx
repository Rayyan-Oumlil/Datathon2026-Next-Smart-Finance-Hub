'use client';

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, MessageSquareText, RotateCcw, SendHorizontal, Undo2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatNumber, formatDateTime } from "@/i18n/format";
import { formatMoment, sourceLabel } from "@/components/agent/time";
import AgentText from "@/components/agent/AgentText";
import StageList, { stageFailed, stageText } from "@/components/agent/StageList";
import { rowsForStage } from "@/lib/agent/stage-rows";
import type { StageLine } from "@/lib/agent/stages";
import { useAgentStream } from "@/hooks/useAgentStream";

type Source = { label: string; source: string; fetchedAt?: string; asOf?: string };
type Check = { filter: string; pass: boolean; detail: string };
type PreviewData = {
    summary: string;
    rows: Array<{ label: string; before: string; after: string }>;
    facts: Array<{ label: string; value: string; source?: string; fetchedAt?: string; asOf?: string }>;
};
type Reply = {
    actionId: string;
    sources: Source[];
    refused?: boolean;
    notice?: string;
    conflict?: { symbol: string; checks: Check[] };
    preview?: PreviewData;
    proposedType?: string;
};
type Message = {
    id: string;
    role: 'user' | 'assistant';
    text: string;
    failed?: boolean;                 // a notice from the app, not a turn of the conversation
    reply?: Reply;
    change?: 'pending' | 'applied' | 'cancelled' | 'undone';
    outcome?: string;
    steps?: StageLine[];              // what the agent did for this reply, each step linked to its log rows
};
type LogRow = { id: string; at: string; step: string; actor: string; modelId?: string; awsRequestId?: string; inputTokens?: number; outputTokens?: number; dataUsed?: unknown };

const STORE_KEY = 'agent-conversation-v1';
const HISTORY_TURNS = 10;
// The chips and what each one sends. The "less" message names a fixed choice (the Novice starting layout):
// the bare words name no widget and the agent would ask which ones to hide, so the reply is a layout preview
// to confirm or cancel. The "rule" chip only starts a sentence in the input.
const QUICK_ACTIONS = ['explain', 'less', 'etf', 'rule'] as const;
type QuickAction = (typeof QUICK_ACTIONS)[number];

type Translator = ReturnType<typeof useTranslations<'AgentPanel'>>;
/** Which time a figure carries: the time the value refers to, and the time it was fetched. */
const timesText = (t: Translator, locale: string, { asOf, fetchedAt }: { asOf?: string; fetchedAt?: string }) =>
    [
        formatMoment(asOf, locale) && t('times.asOf', { time: formatMoment(asOf, locale) }),
        formatMoment(fetchedAt, locale) && t('times.fetched', { time: formatMoment(fetchedAt, locale) }),
    ].filter(Boolean).join(' · ') || t('times.none');
const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

async function post<T>(url: string, body: unknown, fallbackError: string): Promise<T> {
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || fallbackError);
    return data as T;
}

// One row of the action log: what happened, when, and the ids that find it in CloudTrail.
const TraceRow = ({ row }: { row: LogRow }) => {
    const t = useTranslations('AgentPanel');
    const locale = useLocale();
    // 'subagent:market_data' -> "Sub-agent: market_data"; the name after the colon is the technical id
    const actorLabel = (actor: string) => {
        if (actor.startsWith('subagent:')) return t('trace.actors.subagent', { name: actor.slice('subagent:'.length) });
        return t.has(`trace.actors.${actor}`) ? t(`trace.actors.${actor}`) : actor;
    };
    return (
        <>
            <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                <span className="font-semibold text-foreground">{t.has(`trace.steps.${row.step}`) ? t(`trace.steps.${row.step}`) : row.step}</span>
                <span className="num text-faint">{formatDateTime(row.at, locale, { timeStyle: 'medium' })}</span>
            </div>
            <div className="text-muted-foreground">
                {actorLabel(row.actor)}{row.modelId ? ` · ${row.modelId}` : ''}
                {row.inputTokens !== undefined || row.outputTokens !== undefined
                    ? ` · ${t('trace.tokens', { input: row.inputTokens === undefined ? '–' : formatNumber(row.inputTokens, locale), output: row.outputTokens === undefined ? '–' : formatNumber(row.outputTokens, locale) })}`
                    : ''}
            </div>
            {row.awsRequestId && <div className="mono break-all text-faint">{t('trace.awsRequestId', { id: row.awsRequestId })}</div>}
        </>
    );
};

// The action-log rows of one reply: enough to find each model call in CloudTrail by its AWS request id.
// The steps the agent showed while it worked are listed first; selecting one shows the rows that record it.
const Trace = ({ actionId, steps }: { actionId: string; steps?: StageLine[] }) => {
    const t = useTranslations('AgentPanel');
    const [rows, setRows] = useState<LogRow[] | null>(null);
    const [error, setError] = useState('');
    const [selected, setSelected] = useState<number | null>(null);
    const load = useCallback(async () => {
        setError('');
        try {
            const response = await fetch(`/api/agent/log?actionId=${encodeURIComponent(actionId)}`, { cache: 'no-store' });
            const data = await response.json();
            if (!response.ok) throw new Error(data?.error);
            setRows(data.rows);
        } catch {
            setError(t('trace.unavailable'));
        }
    }, [actionId, t]);

    return (
        <details className="mt-2 text-xs" onToggle={(event) => { if (event.currentTarget.open) void load(); }}>
            <summary className="cursor-pointer select-none font-semibold text-faint hover:text-foreground">{t('trace.summary')}</summary>
            <div className="mt-1.5 rounded-lg border border-line p-2">
                <p className="mono break-all text-faint">{t('trace.actionId', { id: actionId })}</p>
                {error && <p className="mt-1 text-down">{error}</p>}
                {!rows && !error && <p className="mt-1 text-faint">{t('trace.loading')}</p>}
                {steps && steps.length > 0 && (
                    <div className="mt-2">
                        <p className="kicker">{t('trace.stepsTitle')}</p>
                        <ol className="mt-1 flex flex-col gap-1">
                            {steps.map((line, index) => {
                                const open = selected === index;
                                const found = rows ? rowsForStage(steps, index, rows) : [];
                                return (
                                    <li key={line.key}>
                                        <button type="button" aria-expanded={open} onClick={() => setSelected(open ? null : index)}
                                            className={cn('flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-start hover:bg-hover', stageFailed(line) ? 'text-down' : 'text-muted-foreground', open && 'bg-hover')}>
                                            <span className="flex-1 text-foreground">{stageText(t, line)}</span>
                                            {line.ms !== undefined && <span className="num text-[11px] text-faint">{t('stages.took', { ms: line.ms })}</span>}
                                        </button>
                                        {open && (
                                            <ul className="ms-2 mt-1 flex flex-col gap-1.5 border-s border-line ps-2">
                                                {!rows ? <li className="text-faint">{t('trace.loading')}</li>
                                                    : found.length === 0 ? <li className="text-faint">{t('trace.noRowsForStep')}</li>
                                                        : found.map((row) => <li key={row.id}><TraceRow row={row as LogRow} /></li>)}
                                            </ul>
                                        )}
                                    </li>
                                );
                            })}
                        </ol>
                    </div>
                )}
                {rows && rows.length === 0 && <p className="mt-1 text-faint">{t('trace.empty')}</p>}
                {rows && rows.length > 0 && (
                    <ol className="mt-1.5 flex flex-col gap-1.5">
                        {rows.map((row) => (
                            <li key={row.id} className="border-t border-line pt-1.5 first:border-t-0 first:pt-0"><TraceRow row={row} /></li>
                        ))}
                    </ol>
                )}
                <button type="button" className="mt-2 font-semibold text-brand-ink hover:underline" onClick={() => void load()}>{t('trace.reload')}</button>
            </div>
        </details>
    );
};

const ConflictBlock = ({ conflict }: { conflict: NonNullable<Reply['conflict']> }) => {
    const t = useTranslations('AgentPanel');
    return (
    <div role="note" className="mt-2 rounded-lg border border-line bg-down-soft p-2.5 text-[13px]">
        <p className="flex items-center gap-1.5 font-bold text-down">
            <AlertTriangle className="h-4 w-4 flex-none" aria-hidden />
            {t('conflict.title', { symbol: conflict.symbol })}
        </p>
        <ul className="mt-1 list-disc ps-5 text-foreground">
            {conflict.checks.map((check, index) => <li key={`${check.filter}-${index}`}>{check.detail}</li>)}
        </ul>
        <p className="mt-1 text-muted-foreground">{t('conflict.note')}</p>
    </div>
    );
};

type PreviewProps = { message: Message; busy: boolean; onDecide: (accept: boolean) => void; onUndo: () => void };

const PreviewCard = ({ message, busy, onDecide, onUndo }: PreviewProps) => {
    const t = useTranslations('AgentPanel');
    const locale = useLocale();
    const preview = message.reply!.preview!;
    return (
        <div className="mt-2 rounded-xl border border-line bg-canvas p-3 text-[13px]">
            <p className="kicker">{t('preview.kicker')}</p>
            <p className="mt-1 font-semibold text-foreground">{preview.summary}</p>
            <dl className="mt-2 flex flex-col gap-2">
                {preview.rows.map((row) => (
                    <div key={row.label}>
                        <dt className="form-label">{row.label}</dt>
                        <dd className="mt-0.5 grid grid-cols-2 gap-2">
                            <span className="rounded-lg bg-hover px-2 py-1 text-muted-foreground"><span className="block text-[11px] font-bold uppercase text-faint">{t('preview.before')}</span>{row.before || '–'}</span>
                            <span className="rounded-lg bg-brand-soft px-2 py-1 text-foreground"><span className="block text-[11px] font-bold uppercase text-brand-ink">{t('preview.after')}</span>{row.after || '–'}</span>
                        </dd>
                    </div>
                ))}
            </dl>
            {preview.facts.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground">
                    {preview.facts.map((fact) => (
                        <li key={fact.label}>
                            <span className="font-semibold text-foreground">{t('preview.factLabel', { label: fact.label })}</span> <span className="num">{fact.value}</span>
                            {fact.source && <span className="text-faint"> · {sourceLabel(t, fact.source)}{fact.fetchedAt || fact.asOf ? ` · ${timesText(t, locale, fact)}` : ''}</span>}
                        </li>
                    ))}
                </ul>
            )}
            {message.change === 'pending' ? (
                <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onDecide(true)}>
                        {message.reply!.conflict ? t('preview.confirmSimulation') : t('preview.confirm')}
                    </button>
                    <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => onDecide(false)}>{t('preview.cancel')}</button>
                </div>
            ) : (
                <div className="mt-3 border-t border-line pt-2" aria-live="polite">
                    <p className="font-semibold text-foreground">
                        {message.change === 'applied' ? t('preview.applied') : message.change === 'undone' ? t('preview.undone') : t('preview.cancelled')}
                    </p>
                    {message.outcome && <p className="text-muted-foreground">{message.outcome}</p>}
                    {message.change === 'applied' && (
                        <button type="button" className="btn btn-ghost mt-2" disabled={busy} onClick={onUndo}>
                            <Undo2 aria-hidden /> {t('preview.undo')}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};

type AgentPanelProps = { open: boolean; onOpenChange: (open: boolean) => void; onDataChanged?: () => void };

// The agent: it explains data and proposes changes. A change is shown as a preview and runs only after Confirm.
const AgentPanel = ({ open, onOpenChange, onDataChanged }: AgentPanelProps) => {
    const t = useTranslations('AgentPanel');
    const locale = useLocale();
    const router = useRouter();
    const [messages, setMessages] = useState<Message[]>([]);
    const [conversationId, setConversationId] = useState('');
    const [draft, setDraft] = useState('');
    const [waiting, setWaiting] = useState(false);
    const [busyAction, setBusyAction] = useState('');
    const [loaded, setLoaded] = useState(false);
    const { stages, ask, stop } = useAgentStream();
    const [revealing, setRevealing] = useState('');         // the reply that is appearing now; stored ones show at once
    const doneRevealing = useCallback(() => setRevealing(''), []);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const endRef = useRef<HTMLDivElement>(null);

    // The conversation lives in this browser tab only
    useEffect(() => {
        let stored: { conversationId?: string; messages?: Message[] } = {};
        try {
            stored = JSON.parse(window.sessionStorage.getItem(STORE_KEY) ?? '{}');
        } catch { /* an unreadable entry starts a new conversation */ }
        setConversationId(stored.conversationId || newId());
        setMessages(Array.isArray(stored.messages) ? stored.messages : []);
        setLoaded(true);
    }, []);

    useEffect(() => {
        if (!loaded) return;
        try {
            window.sessionStorage.setItem(STORE_KEY, JSON.stringify({ conversationId, messages }));
        } catch { /* storage full or blocked: the conversation stays in memory */ }
    }, [loaded, conversationId, messages]);

    useEffect(() => {
        if (open) endRef.current?.scrollIntoView({ block: 'end' });
    }, [open, messages, waiting, stages, revealing]);

    useEffect(() => {
        if (!open) return;
        inputRef.current?.focus();
        const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onOpenChange(false); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onOpenChange]);

    const patch = (id: string, change: Partial<Message>) => setMessages((list) => list.map((message) => (message.id === id ? { ...message, ...change } : message)));
    const notice = (text: string) => setMessages((list) => [...list, { id: newId(), role: 'assistant', text, failed: true }]);

    const send = async (text: string) => {
        const message = text.trim();
        if (!message || waiting) return;
        const history = messages.filter((m) => !m.failed).slice(-HISTORY_TURNS).map(({ role, text: turn }) => ({ role, text: turn }));
        setMessages((list) => [...list, { id: newId(), role: 'user', text: message }]);
        setDraft('');
        setWaiting(true);
        try {
            const { reply, steps } = await ask<Reply & { text: string; proposed?: { type: string } }>({ message, history, conversationId }, t('errors.request'));
            const id = newId();
            setRevealing(id);
            setMessages((list) => [...list, {
                id, role: 'assistant', text: reply.text, change: reply.preview ? 'pending' : undefined, steps,
                reply: { actionId: reply.actionId, sources: reply.sources ?? [], refused: reply.refused, notice: reply.notice, conflict: reply.conflict, preview: reply.preview, proposedType: reply.proposed?.type },
            }]);
        } catch (error) {
            // A stop the reader asked for is not a failure: say so and leave the conversation as it was
            notice(error instanceof DOMException && error.name === 'AbortError' ? t('stopped') : error instanceof Error ? error.message : t('errors.request'));
        } finally {
            setWaiting(false);
        }
    };

    // Pages read their data on the server or on their own; both are told that something changed
    const dataChanged = () => {
        router.refresh();
        onDataChanged?.();
        window.dispatchEvent(new CustomEvent('agent:data-changed'));
    };

    const decide = async (message: Message, accept: boolean) => {
        const { actionId } = message.reply!;
        setBusyAction(actionId);
        try {
            const outcome = await post<{ applied: boolean; message?: string }>('/api/agent/confirm', { actionId, accept }, t('errors.apply'));
            patch(message.id, { change: outcome.applied ? 'applied' : 'cancelled', outcome: outcome.message });
            if (outcome.applied) dataChanged();
        } catch (error) {
            notice(error instanceof Error ? error.message : t('errors.apply'));
        } finally {
            setBusyAction('');
        }
    };

    const undo = async (message: Message) => {
        const { actionId } = message.reply!;
        setBusyAction(actionId);
        try {
            const outcome = await post<{ restored: boolean; message?: string }>('/api/agent/undo', { actionId }, t('errors.undo'));
            patch(message.id, { change: outcome.restored ? 'undone' : 'applied', outcome: outcome.message });
            if (outcome.restored) dataChanged();
        } catch (error) {
            notice(error instanceof Error ? error.message : t('errors.undo'));
        } finally {
            setBusyAction('');
        }
    };

    const quick = (id: QuickAction) => {
        if (id === 'rule') {
            setDraft(t('quick.rule.message'));
            inputRef.current?.focus();
        } else void send(t(`quick.${id}.message`));
    };

    const reset = () => {
        setMessages([]);
        setConversationId(newId());
    };

    if (!open) {
        return (
            <button type="button" className="btn btn-primary fixed bottom-4 right-4 z-30 rtl:left-4 rtl:right-auto" onClick={() => onOpenChange(true)} aria-expanded={false} aria-controls="agent-panel">
                <MessageSquareText aria-hidden /> {t('title')}
            </button>
        );
    }

    return (
        <>
            <div className="fixed inset-0 z-40 bg-page/60 backdrop-blur-[2px] lg:hidden" onClick={() => onOpenChange(false)} />
            <aside
                id="agent-panel"
                aria-label={t('title')}
                className="min-h-0 max-lg:fixed max-lg:inset-y-0 max-lg:right-0 max-lg:z-50 max-lg:w-full max-lg:max-w-[420px] max-lg:rtl:left-0 max-lg:rtl:right-auto lg:py-2.5 lg:pe-2.5"
            >
                <div className="flex h-full flex-col overflow-hidden bg-card lg:rounded-2xl lg:border lg:border-line">
                    <header className="flex items-start justify-between gap-2 border-b border-line px-3.5 py-3">
                        <div className="min-w-0">
                            <p className="kicker">{t('kicker')}</p>
                            <h2 className="section-title">{t('title')}</h2>
                        </div>
                        <div className="flex flex-none gap-1">
                            <button type="button" className="icon-btn" onClick={reset} aria-label={t('newConversation')} title={t('newConversation')}><RotateCcw aria-hidden /></button>
                            <button type="button" className="icon-btn" onClick={() => onOpenChange(false)} aria-label={t('closePanel')} title={t('closeTitle')}><X aria-hidden /></button>
                        </div>
                    </header>

                    <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3" role="log" aria-live="polite" aria-label={t('conversation')}>
                        {messages.length === 0 && !waiting && (
                            <div className="empty-state">
                                <span className="empty-icon"><MessageSquareText className="h-5 w-5" aria-hidden /></span>
                                <h3>{t('emptyTitle')}</h3>
                                <p className="text-[13px]">{t('emptyBody')}</p>
                            </div>
                        )}
                        <ol className="flex flex-col gap-3">
                            {messages.map((message) => (
                                <li key={message.id} className={cn('flex flex-col', message.role === 'user' ? 'items-end' : 'items-stretch')}>
                                    {message.role === 'user' ? (
                                        <p className="max-w-[88%] whitespace-pre-wrap break-words rounded-2xl bg-brand-soft px-3 py-2 text-sm text-foreground"><span className="sr-only">{t('youSaid')}</span>{message.text}</p>
                                    ) : (
                                        <div className={cn('rounded-2xl border border-line px-3 py-2 text-sm', message.failed && 'bg-down-soft')}>
                                            <AgentText text={message.text} animate={revealing === message.id} onDone={doneRevealing} />
                                            {message.reply && (
                                                <>
                                                    {message.reply.sources.length > 0 && (
                                                        <ul className="mt-2 flex flex-wrap gap-1" aria-label={t('sources')}>
                                                            {message.reply.sources.map((source, index) => (
                                                                <li key={`${source.label}-${index}`} className="max-w-full rounded-lg bg-hover px-2 py-1 text-[11px] leading-tight text-muted-foreground">
                                                                    <span className="font-semibold text-foreground">{source.label}</span> · {sourceLabel(t, source.source)} · {timesText(t, locale, source)}
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    )}
                                                    {message.reply.sources.length === 0 && !message.reply.refused && <p className="mt-2 text-[11px] text-faint">{t('noSource')}</p>}
                                                    {message.reply.conflict && message.reply.conflict.checks.length > 0 && <ConflictBlock conflict={message.reply.conflict} />}
                                                    {message.reply.notice && <p className="mt-2 text-[13px] text-muted-foreground">{message.reply.notice}</p>}
                                                    {message.reply.preview && (
                                                        <PreviewCard message={message} busy={busyAction === message.reply.actionId} onDecide={(accept) => void decide(message, accept)} onUndo={() => void undo(message)} />
                                                    )}
                                                    <Trace actionId={message.reply.actionId} steps={message.steps} />
                                                </>
                                            )}
                                        </div>
                                    )}
                                </li>
                            ))}
                        </ol>
                        {waiting && <StageList stages={stages} onStop={stop} />}
                        <div ref={endRef} />
                    </div>

                    <footer className="border-t border-line px-3.5 py-3">
                        <div className="mb-2 flex flex-wrap gap-1.5" role="group" aria-label={t('quickActions')}>
                            {QUICK_ACTIONS.map((id) => (
                                <button key={id} type="button" className="btn btn-ghost h-8 px-2.5 text-xs" disabled={waiting} onClick={() => quick(id)}>{t(`quick.${id}.label`)}</button>
                            ))}
                        </div>
                        <form className="flex items-end gap-2" onSubmit={(event) => { event.preventDefault(); void send(draft); }}>
                            <label htmlFor="agent-input" className="sr-only">{t('inputLabel')}</label>
                            <textarea
                                id="agent-input"
                                ref={inputRef}
                                rows={2}
                                maxLength={2000}
                                value={draft}
                                onChange={(event) => setDraft(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                                        event.preventDefault();
                                        void send(draft);
                                    }
                                }}
                                placeholder={t('placeholder')}
                                className="min-h-[44px] flex-1 resize-none rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-foreground placeholder:text-faint focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand"
                            />
                            <button type="submit" className="btn btn-primary h-11 px-3" disabled={waiting || !draft.trim()} aria-label={t('send')}><SendHorizontal aria-hidden /></button>
                        </form>
                    </footer>
                </div>
            </aside>
        </>
    );
};

export default AgentPanel;
