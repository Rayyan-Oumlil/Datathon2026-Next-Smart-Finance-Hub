'use client';

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, MessageSquareText, RotateCcw, SendHorizontal, Undo2, X } from "lucide-react";
import { cn } from "@/lib/utils";

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
};
type LogRow = { id: string; at: string; step: string; actor: string; modelId?: string; awsRequestId?: string; inputTokens?: number; outputTokens?: number };

const STORE_KEY = 'agent-conversation-v1';
const HISTORY_TURNS = 10;
const QUICK_ACTIONS = ['Explain a pick on my list', 'Show me less', 'What is an ETF?', 'Create a rule'];
const RULE_STARTER = 'Create a rule: when ';
// Sent for the "Show me less" chip. The bare words name no widget and the agent then asks which ones to hide;
// this names a fixed choice (the Novice starting layout), so the reply is a layout preview to confirm or cancel.
const SHOW_LESS = 'Show me less: hide every widget whose minLevel is above Novice, keep the others in their order';

// A date without a time is shown as written: read as a timestamp it would shift by the viewer's time zone
const when = (iso?: string) => {
    if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
    const time = iso ? new Date(iso) : null;
    return time && !Number.isNaN(time.getTime()) ? time.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';
};
/** Which time a figure carries: the time the value refers to, and the time it was fetched. */
const times = ({ asOf, fetchedAt }: { asOf?: string; fetchedAt?: string }) =>
    [when(asOf) && `as of ${when(asOf)}`, when(fetchedAt) && `fetched ${when(fetchedAt)}`].filter(Boolean).join(' · ') || 'time not available';
const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

async function post<T>(url: string, body: unknown): Promise<T> {
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || 'The request could not be completed.');
    return data as T;
}

// The action-log rows of one reply: enough to find each model call in CloudTrail by its AWS request id.
const Trace = ({ actionId }: { actionId: string }) => {
    const [rows, setRows] = useState<LogRow[] | null>(null);
    const [error, setError] = useState('');
    const load = useCallback(async () => {
        setError('');
        try {
            const response = await fetch(`/api/agent/log?actionId=${encodeURIComponent(actionId)}`, { cache: 'no-store' });
            const data = await response.json();
            if (!response.ok) throw new Error(data?.error);
            setRows(data.rows);
        } catch {
            setError('The log rows are not available right now.');
        }
    }, [actionId]);

    return (
        <details className="mt-2 text-xs" onToggle={(event) => { if (event.currentTarget.open) void load(); }}>
            <summary className="cursor-pointer select-none font-semibold text-faint hover:text-foreground">Trace</summary>
            <div className="mt-1.5 rounded-lg border border-line p-2">
                <p className="mono break-all text-faint">action id: {actionId}</p>
                {error && <p className="mt-1 text-down">{error}</p>}
                {!rows && !error && <p className="mt-1 text-faint">Loading the log rows…</p>}
                {rows && rows.length === 0 && <p className="mt-1 text-faint">No row is readable yet. The index can lag by a few seconds.</p>}
                {rows && rows.length > 0 && (
                    <ol className="mt-1.5 flex flex-col gap-1.5">
                        {rows.map((row) => (
                            <li key={row.id} className="border-t border-line pt-1.5 first:border-t-0 first:pt-0">
                                <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                                    <span className="font-semibold text-foreground">{row.step}</span>
                                    <span className="num text-faint">{new Date(row.at).toLocaleTimeString()}</span>
                                </div>
                                <div className="text-muted-foreground">
                                    {row.actor}{row.modelId ? ` · ${row.modelId}` : ''}
                                    {row.inputTokens !== undefined || row.outputTokens !== undefined ? ` · tokens ${row.inputTokens ?? '–'} in / ${row.outputTokens ?? '–'} out` : ''}
                                </div>
                                {row.awsRequestId && <div className="mono break-all text-faint">AWS request id: {row.awsRequestId}</div>}
                            </li>
                        ))}
                    </ol>
                )}
                <button type="button" className="mt-2 font-semibold text-brand-ink hover:underline" onClick={() => void load()}>Reload rows</button>
            </div>
        </details>
    );
};

const ConflictBlock = ({ conflict }: { conflict: NonNullable<Reply['conflict']> }) => (
    <div role="note" className="mt-2 rounded-lg border border-line bg-down-soft p-2.5 text-[13px]">
        <p className="flex items-center gap-1.5 font-bold text-down">
            <AlertTriangle className="h-4 w-4 flex-none" aria-hidden />
            Profile conflict: {conflict.symbol}
        </p>
        <ul className="mt-1 list-disc ps-5 text-foreground">
            {conflict.checks.map((check, index) => <li key={`${check.filter}-${index}`}>{check.detail}</li>)}
        </ul>
        <p className="mt-1 text-muted-foreground">Values are from the profile&apos;s own filters. You can still proceed in the simulation; the conflict is logged.</p>
    </div>
);

type PreviewProps = { message: Message; busy: boolean; onDecide: (accept: boolean) => void; onUndo: () => void };

const PreviewCard = ({ message, busy, onDecide, onUndo }: PreviewProps) => {
    const preview = message.reply!.preview!;
    return (
        <div className="mt-2 rounded-xl border border-line bg-canvas p-3 text-[13px]">
            <p className="kicker">Preview · nothing is applied yet · simulated</p>
            <p className="mt-1 font-semibold text-foreground">{preview.summary}</p>
            <dl className="mt-2 flex flex-col gap-2">
                {preview.rows.map((row) => (
                    <div key={row.label}>
                        <dt className="form-label">{row.label}</dt>
                        <dd className="mt-0.5 grid grid-cols-2 gap-2">
                            <span className="rounded-lg bg-hover px-2 py-1 text-muted-foreground"><span className="block text-[11px] font-bold uppercase text-faint">Before</span>{row.before || '–'}</span>
                            <span className="rounded-lg bg-brand-soft px-2 py-1 text-foreground"><span className="block text-[11px] font-bold uppercase text-brand-ink">After</span>{row.after || '–'}</span>
                        </dd>
                    </div>
                ))}
            </dl>
            {preview.facts.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground">
                    {preview.facts.map((fact) => (
                        <li key={fact.label}>
                            <span className="font-semibold text-foreground">{fact.label}:</span> <span className="num">{fact.value}</span>
                            {fact.source && <span className="text-faint"> · {fact.source}{fact.fetchedAt || fact.asOf ? ` · ${times(fact)}` : ''}</span>}
                        </li>
                    ))}
                </ul>
            )}
            {message.change === 'pending' ? (
                <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onDecide(true)}>
                        {message.reply!.conflict ? 'Confirm in simulation' : 'Confirm'}
                    </button>
                    <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => onDecide(false)}>Cancel</button>
                </div>
            ) : (
                <div className="mt-3 border-t border-line pt-2" aria-live="polite">
                    <p className="font-semibold text-foreground">
                        {message.change === 'applied' ? 'Applied' : message.change === 'undone' ? 'Undone' : 'Cancelled'}
                    </p>
                    {message.outcome && <p className="text-muted-foreground">{message.outcome}</p>}
                    {message.change === 'applied' && (
                        <button type="button" className="btn btn-ghost mt-2" disabled={busy} onClick={onUndo}>
                            <Undo2 aria-hidden /> Undo
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
    const router = useRouter();
    const [messages, setMessages] = useState<Message[]>([]);
    const [conversationId, setConversationId] = useState('');
    const [draft, setDraft] = useState('');
    const [waiting, setWaiting] = useState(false);
    const [busyAction, setBusyAction] = useState('');
    const [loaded, setLoaded] = useState(false);
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
    }, [open, messages, waiting]);

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
            const reply = await post<Reply & { text: string; proposed?: { type: string } }>('/api/agent', { message, history, conversationId });
            setMessages((list) => [...list, {
                id: newId(), role: 'assistant', text: reply.text, change: reply.preview ? 'pending' : undefined,
                reply: { actionId: reply.actionId, sources: reply.sources ?? [], refused: reply.refused, notice: reply.notice, conflict: reply.conflict, preview: reply.preview, proposedType: reply.proposed?.type },
            }]);
        } catch (error) {
            notice(error instanceof Error ? error.message : 'The request could not be completed.');
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
            const outcome = await post<{ applied: boolean; message?: string }>('/api/agent/confirm', { actionId, accept });
            patch(message.id, { change: outcome.applied ? 'applied' : 'cancelled', outcome: outcome.message });
            if (outcome.applied) dataChanged();
        } catch (error) {
            notice(error instanceof Error ? error.message : 'The change could not be applied.');
        } finally {
            setBusyAction('');
        }
    };

    const undo = async (message: Message) => {
        const { actionId } = message.reply!;
        setBusyAction(actionId);
        try {
            const outcome = await post<{ restored: boolean; message?: string }>('/api/agent/undo', { actionId });
            patch(message.id, { change: outcome.restored ? 'undone' : 'applied', outcome: outcome.message });
            if (outcome.restored) dataChanged();
        } catch (error) {
            notice(error instanceof Error ? error.message : 'The change could not be undone.');
        } finally {
            setBusyAction('');
        }
    };

    const quick = (label: string) => {
        if (label === 'Create a rule') {
            setDraft(RULE_STARTER);
            inputRef.current?.focus();
        } else void send(label === 'Show me less' ? SHOW_LESS : label);
    };

    const reset = () => {
        setMessages([]);
        setConversationId(newId());
    };

    if (!open) {
        return (
            <button type="button" className="btn btn-primary fixed bottom-4 right-4 z-30 rtl:left-4 rtl:right-auto" onClick={() => onOpenChange(true)} aria-expanded={false} aria-controls="agent-panel">
                <MessageSquareText aria-hidden /> Agent
            </button>
        );
    }

    return (
        <>
            <div className="fixed inset-0 z-40 bg-page/60 backdrop-blur-[2px] lg:hidden" onClick={() => onOpenChange(false)} />
            <aside
                id="agent-panel"
                aria-label="Agent"
                className="min-h-0 max-lg:fixed max-lg:inset-y-0 max-lg:right-0 max-lg:z-50 max-lg:w-full max-lg:max-w-[420px] max-lg:rtl:left-0 max-lg:rtl:right-auto lg:py-2.5 lg:pe-2.5"
            >
                <div className="flex h-full flex-col overflow-hidden bg-card lg:rounded-2xl lg:border lg:border-line">
                    <header className="flex items-start justify-between gap-2 border-b border-line px-3.5 py-3">
                        <div className="min-w-0">
                            <p className="kicker">Simulation · explains data · no investment advice</p>
                            <h2 className="section-title">Agent</h2>
                        </div>
                        <div className="flex flex-none gap-1">
                            <button type="button" className="icon-btn" onClick={reset} aria-label="Start a new conversation" title="Start a new conversation"><RotateCcw aria-hidden /></button>
                            <button type="button" className="icon-btn" onClick={() => onOpenChange(false)} aria-label="Close the agent panel" title="Close"><X aria-hidden /></button>
                        </div>
                    </header>

                    <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3" role="log" aria-live="polite" aria-label="Conversation">
                        {messages.length === 0 && !waiting && (
                            <div className="empty-state">
                                <span className="empty-icon"><MessageSquareText className="h-5 w-5" aria-hidden /></span>
                                <h3>Ask about your data</h3>
                                <p className="text-[13px]">Every figure in a reply comes with its source and time. A change to your layout, rules, profile or simulated portfolio is shown as a preview first, and you can undo it.</p>
                            </div>
                        )}
                        <ol className="flex flex-col gap-3">
                            {messages.map((message) => (
                                <li key={message.id} className={cn('flex flex-col', message.role === 'user' ? 'items-end' : 'items-stretch')}>
                                    {message.role === 'user' ? (
                                        <p className="max-w-[88%] whitespace-pre-wrap break-words rounded-2xl bg-brand-soft px-3 py-2 text-sm text-foreground"><span className="sr-only">You: </span>{message.text}</p>
                                    ) : (
                                        <div className={cn('rounded-2xl border border-line px-3 py-2 text-sm', message.failed && 'bg-down-soft')}>
                                            <p className="whitespace-pre-wrap break-words text-foreground"><span className="sr-only">Agent: </span>{message.text}</p>
                                            {message.reply && (
                                                <>
                                                    {message.reply.sources.length > 0 && (
                                                        <ul className="mt-2 flex flex-wrap gap-1" aria-label="Sources">
                                                            {message.reply.sources.map((source, index) => (
                                                                <li key={`${source.label}-${index}`} className="max-w-full rounded-lg bg-hover px-2 py-1 text-[11px] leading-tight text-muted-foreground">
                                                                    <span className="font-semibold text-foreground">{source.label}</span> · {source.source} · {times(source)}
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    )}
                                                    {message.reply.sources.length === 0 && !message.reply.refused && <p className="mt-2 text-[11px] text-faint">This reply cites no data source.</p>}
                                                    {message.reply.conflict && message.reply.conflict.checks.length > 0 && <ConflictBlock conflict={message.reply.conflict} />}
                                                    {message.reply.notice && <p className="mt-2 text-[13px] text-muted-foreground">{message.reply.notice}</p>}
                                                    {message.reply.preview && (
                                                        <PreviewCard message={message} busy={busyAction === message.reply.actionId} onDecide={(accept) => void decide(message, accept)} onUndo={() => void undo(message)} />
                                                    )}
                                                    <Trace actionId={message.reply.actionId} />
                                                </>
                                            )}
                                        </div>
                                    )}
                                </li>
                            ))}
                        </ol>
                        {waiting && <p className="mt-3 text-[13px] text-faint">Working on it. A reply can take up to a minute: each figure is fetched and checked.</p>}
                        <div ref={endRef} />
                    </div>

                    <footer className="border-t border-line px-3.5 py-3">
                        <div className="mb-2 flex flex-wrap gap-1.5" role="group" aria-label="Quick actions">
                            {QUICK_ACTIONS.map((label) => (
                                <button key={label} type="button" className="btn btn-ghost h-8 px-2.5 text-xs" disabled={waiting} onClick={() => quick(label)}>{label}</button>
                            ))}
                        </div>
                        <form className="flex items-end gap-2" onSubmit={(event) => { event.preventDefault(); void send(draft); }}>
                            <label htmlFor="agent-input" className="sr-only">Message to the agent</label>
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
                                placeholder="Ask about a term, a pick, your simulated portfolio…"
                                className="min-h-[44px] flex-1 resize-none rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-foreground placeholder:text-faint focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand"
                            />
                            <button type="submit" className="btn btn-primary h-11 px-3" disabled={waiting || !draft.trim()} aria-label="Send message"><SendHorizontal aria-hidden /></button>
                        </form>
                    </footer>
                </div>
            </aside>
        </>
    );
};

export default AgentPanel;
