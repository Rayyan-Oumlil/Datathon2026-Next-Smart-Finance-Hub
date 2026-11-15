'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, MessageSquareText, RotateCcw, SendHorizontal, Undo2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Locale } from "@/i18n/config";
import { formatNumber, formatDateTime } from "@/i18n/format";
import { formatMoment, sourceLabel } from "@/components/agent/time";
import AgentText from "@/components/agent/AgentText";
import StageList, { reworded, stageFailed, stageText } from "@/components/agent/StageList";
import Timeline from "@/components/agent/Timeline";
import Link from "next/link";
import { rowsForStage } from "@/lib/agent/stage-rows";
import type { StageLine } from "@/lib/agent/stages";
import { useAgentStream } from "@/hooks/useAgentStream";
import { SpeakerButton, VoiceButton, VoiceStatus } from "@/components/agent/Voice";
import { useSpeech } from "@/hooks/useSpeech";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import PreviewDetails, { timesText, type PreviewData } from "@/components/agent/PreviewDetails";
import ProposalDock, { type DockKind } from "@/components/agent/ProposalDock";
import { PROPOSAL_CHANGED_EVENT, PROPOSAL_DECIDE_EVENT } from "@/hooks/usePendingProposal";
import { toast } from "sonner";
import { KEY_STEP, PANEL_DEFAULT, PANEL_MAX, PANEL_MIN, stepWidth, swipeOf, widthFromDrag } from "@/components/agent/panel-width";

type Source = { label: string; source: string; fetchedAt?: string; asOf?: string };
type Check = { filter: string; pass: boolean; detail: string };
type Reply = {
    actionId: string;
    language?: Locale;                // the language the reply is in: the question's own, not necessarily the app's
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
    strategyId?: string;              // a strategy saved by Confirm: links to the time machine
    steps?: StageLine[];              // what the agent did for this reply, each step linked to its log rows
};
type LogRow = { id: string; at: string; step: string; actor: string; modelId?: string; awsRequestId?: string; inputTokens?: number; outputTokens?: number; dataUsed?: unknown };

const STORE_KEY = 'agent-conversation-v1';
const HISTORY_TURNS = 10;
// The chips and what each one sends. The "less" message names a fixed choice (the Novice starting layout):
// the bare words name no widget and the agent would ask which ones to hide, so the reply is a layout preview
// to confirm or cancel. The "rule" chip only starts a sentence in the input.
// "strategy" starts a sentence too; "testStrategy" asks for a replay of the stored strategy.
const QUICK_ACTIONS = ['explain', 'less', 'etf', 'rule', 'strategy', 'testStrategy'] as const;
type QuickAction = (typeof QUICK_ACTIONS)[number];

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
                                            className={cn('flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-start hover:bg-hover', stageFailed(line) && !reworded(line) ? 'text-down' : 'text-muted-foreground', open && 'bg-hover')}>
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

// where: 'chat' is the card in the conversation; 'page' is the same preview on the page the change belongs to, where it is saved.
// A change that has a page is not confirmed in the chat: its chat card only says where it went.
type PreviewProps = { message: Message; busy: boolean; onDecide: (accept: boolean) => void; onUndo: () => void; where?: 'chat' | 'page' };

export const PreviewCard = ({ message, busy, onDecide, onUndo, where = 'chat' }: PreviewProps) => {
    const t = useTranslations('AgentPanel');
    const locale = useLocale();
    const preview = message.reply!.preview!;
    const viaPage = where === 'chat' && Boolean(preview.page);
    return (
        <div className="mt-2 rounded-xl border border-line bg-canvas p-3 text-[13px]">
            <p className="kicker">{viaPage ? t('preview.pageKickerChat') : where === 'page' ? t('preview.pageKicker') : t('preview.kicker')}</p>
            <p className="mt-1 font-semibold text-foreground">{preview.summary}</p>
            {viaPage && message.change === 'pending' && preview.page && (
                <Link href={preview.page} className="mt-1 inline-flex items-center gap-1 font-semibold text-brand-ink hover:underline">
                    {t('preview.openPage', { page: t(`pageName.${preview.page.slice(1)}`) })} →
                </Link>
            )}
            {!viaPage && <PreviewDetails preview={preview} />}
            {message.change === 'pending' ? (viaPage ? null : (
                <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onDecide(true)}>
                        {where === 'page' ? t('preview.save') : message.reply!.conflict ? t('preview.confirmSimulation') : t('preview.confirm')}
                    </button>
                    <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => onDecide(false)}>{t('preview.cancel')}</button>
                </div>
            )) : (
                <div className="mt-3 border-t border-line pt-2" aria-live="polite">
                    <p className="font-semibold text-foreground">
                        {message.change === 'applied' ? (preview.page ? t('preview.saved') : t('preview.applied')) : message.change === 'undone' ? t('preview.undone') : t('preview.cancelled')}
                    </p>
                    {message.outcome && <p className="text-muted-foreground">{message.outcome}</p>}
                    {message.change === 'applied' && message.strategyId && (
                        <Link href={`/time-machine?strategy=${encodeURIComponent(message.strategyId)}`} className="mt-1 inline-block font-semibold text-brand-ink hover:underline">
                            {t('preview.strategy.openTimeMachine')}
                        </Link>
                    )}
                    {message.change === 'applied' && !viaPage && (
                        <button type="button" className="btn btn-ghost mt-2" disabled={busy} onClick={onUndo}>
                            <Undo2 aria-hidden /> {t('preview.undo')}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};

import { AGENT_ASK_EVENT, getPageDetail } from "@/lib/agent/page-detail";

// width and onResize: the panel's width on a wide screen (px); final is true when a drag or swipe ends, to keep the value
type AgentPanelProps = { open: boolean; onOpenChange: (open: boolean) => void; onDataChanged?: () => void; width?: number; onResize?: (width: number, final: boolean) => void };

// The agent: it explains data and proposes changes. A change is shown as a preview and runs only after Confirm.
const AgentPanel = ({ open, onOpenChange, onDataChanged, width = PANEL_DEFAULT, onResize }: AgentPanelProps) => {
    const t = useTranslations('AgentPanel');
    // The page a proposed change is saved on shows it in a slot the shell provides; this panel fills the slot
    const [slot, setSlot] = useState<HTMLElement | null>(null);
    useEffect(() => setSlot(document.getElementById('agent-proposal-slot')), []);
    const [decidedHere, setDecidedHere] = useState<string | null>(null);   // the proposal just saved, cancelled or undone on its page
    const [dismissed, setDismissed] = useState<string[]>([]);
    const drag = useRef<{ startX: number; startWidth: number } | null>(null);
    const swipe = useRef<{ x: number; y: number } | null>(null);
    const isRtl = () => document.documentElement.dir === 'rtl';
    const wide = () => window.matchMedia('(min-width: 1024px)').matches;
    // Dragging the panel's inner edge resizes it continuously
    const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
        drag.current = { startX: event.clientX, startWidth: width };
        event.currentTarget.setPointerCapture(event.pointerId);
    };
    const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
        if (drag.current) onResize?.(widthFromDrag(drag.current.startWidth, drag.current.startX, event.clientX, isRtl(), window.innerWidth), false);
    };
    const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!drag.current) return;
        onResize?.(widthFromDrag(drag.current.startWidth, drag.current.startX, event.clientX, isRtl(), window.innerWidth), true);
        drag.current = null;
    };
    const keyResize = (event: React.KeyboardEvent<HTMLDivElement>) => {
        const toward = isRtl() ? 'ArrowRight' : 'ArrowLeft';
        const away = isRtl() ? 'ArrowLeft' : 'ArrowRight';
        if (event.key !== toward && event.key !== away && event.key !== 'Home' && event.key !== 'End') return;
        event.preventDefault();
        const next = event.key === 'Home' ? PANEL_MIN : event.key === 'End' ? PANEL_MAX : width + (event.key === toward ? KEY_STEP : -KEY_STEP);
        onResize?.(next, true);
    };
    // A swipe on the header steps between compact, normal and wide; on a small screen, swiping toward the edge closes the drawer
    const swipeStart = (event: React.PointerEvent<HTMLElement>) => { swipe.current = { x: event.clientX, y: event.clientY }; };
    const swipeEnd = (event: React.PointerEvent<HTMLElement>) => {
        const start = swipe.current;
        swipe.current = null;
        if (!start) return;
        const direction = swipeOf(event.clientX - start.x, event.clientY - start.y, isRtl());
        if (!direction) return;
        if (!wide()) { if (direction === 'narrower') onOpenChange(false); return; }
        onResize?.(stepWidth(width, direction === 'wider' ? 1 : -1, window.innerWidth), true);
    };
    const locale = useLocale();
    const router = useRouter();
    const pathname = usePathname();
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
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            if (voiceRef.current.active) { sendWhenHeard.current = false; voiceRef.current.cancel(); setDraft(voiceBase.current); }
            else if (speechRef.current.speaking) speechRef.current.stop();
            else onOpenChange(false);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onOpenChange]);

    // A reply to a spoken question is read aloud. Asking again, closing the panel or starting over cuts it off.
    const speech = useSpeech();
    const speechRef = useRef(speech);
    speechRef.current = speech;
    useEffect(() => { if (!open) speechRef.current.stop(); }, [open]);

    // Dictation: the live text fills the box after whatever was typed. When the microphone stops, the text stays in the
    // box, editable; nothing is sent until Enter or Send. Starting the microphone again appends to what is there.
    const voiceBase = useRef('');
    const dictated = useRef(false);          // the box holds dictated text: its reply is read aloud, as for a spoken question
    const sendWhenHeard = useRef(false);     // Enter or Send pressed while dictating: send once the last words are in
    const withBase = (text: string) => [voiceBase.current, text].filter(Boolean).join(' ').slice(0, 2000);
    const voice = useVoiceInput({
        enabled: open,
        onStart: () => { speechRef.current.stop(); speechRef.current.prime(); voiceBase.current = draft.trim(); },
        onText: (text) => setDraft(withBase(text)),
        onFinal: (text) => {
            const full = withBase(text);
            dictated.current = true;
            setDraft(full);
            if (sendWhenHeard.current && !waiting) void send(full, true);
            sendWhenHeard.current = false;
            inputRef.current?.focus();
        },
        onEnd: () => { if (sendWhenHeard.current) { sendWhenHeard.current = false; void send(draftRef.current, dictated.current); } },
    });
    const voiceRef = useRef(voice);
    voiceRef.current = voice;
    const draftRef = useRef(draft);
    draftRef.current = draft;
    // Send or Enter while dictating ends the dictation and sends the text once its last words are in; otherwise the
    // text in the box is sent as it is (a reply to dictated text is read aloud)
    const submit = () => {
        if (voiceRef.current.active) { sendWhenHeard.current = true; voiceRef.current.stop(); return; }
        void send(draft, dictated.current);
    };

    const patch = (id: string, change: Partial<Message>) => setMessages((list) => list.map((message) => (message.id === id ? { ...message, ...change } : message)));
    const notice = (text: string) => setMessages((list) => [...list, { id: newId(), role: 'assistant', text, failed: true }]);

    // Bumped when the conversation is started over: a reply to a question of the old conversation is then dropped
    const conversationRun = useRef(0);

    const send = async (text: string, viaVoice = false) => {
        const message = text.trim();
        if (!message || waiting) return;
        speechRef.current.stop();
        const ticket = speechRef.current.ticket();
        const run = conversationRun.current;
        const history = messages.filter((m) => !m.failed).slice(-HISTORY_TURNS).map(({ role, text: turn }) => ({ role, text: turn }));
        setMessages((list) => [...list, { id: newId(), role: 'user', text: message }]);
        setDraft('');
        dictated.current = false;
        setWaiting(true);
        try {
            const { reply, steps } = await ask<Reply & { text: string; proposed?: { type: string } }>({ message, history, conversationId, page: { path: pathname, ...getPageDetail() } }, t('errors.request'));
            const id = newId();
            setRevealing(id);
            if (run !== conversationRun.current) return;
            setMessages((list) => [...list, {
                id, role: 'assistant', text: reply.text, change: reply.preview ? 'pending' : undefined, steps,
                reply: { actionId: reply.actionId, language: reply.language, sources: reply.sources ?? [], refused: reply.refused, notice: reply.notice, conflict: reply.conflict, preview: reply.preview, proposedType: reply.proposed?.type },
            }]);
            // A change that belongs on a page: take the visitor there. They review and save it on that page, not in the chat.
            const page = reply.preview?.page;
            if (page) {
                if (!pathname.startsWith(page)) router.push(page);
                else router.refresh();   // already there: the page reads the new proposal and previews it
                window.dispatchEvent(new CustomEvent(PROPOSAL_CHANGED_EVENT));
                if (!window.matchMedia('(min-width: 1024px)').matches) onOpenChange(false);   // on a small screen the panel would cover the page
            }
            if (viaVoice && !speechRef.current.muted && !voiceRef.current.active) void speechRef.current.speak(reply.text, ticket, reply.language);
        } catch (error) {
            // A stop the reader asked for is not a failure: say so and leave the conversation as it was
            if (run === conversationRun.current) notice(error instanceof DOMException && error.name === 'AbortError' ? t('stopped') : error instanceof Error ? error.message : t('errors.request'));
        } finally {
            if (run === conversationRun.current) setWaiting(false);
        }
    };

    // A page can ask the agent a ready-made question ("Explain this X-ray"): the panel opens and sends it
    const sendRef = useRef(send);
    sendRef.current = send;
    useEffect(() => {
        const onAsk = (event: Event) => {
            const message = (event as CustomEvent<{ message?: string }>).detail?.message;
            if (!message) return;
            onOpenChange(true);
            void sendRef.current(message);
        };
        window.addEventListener(AGENT_ASK_EVENT, onAsk);
        return () => window.removeEventListener(AGENT_ASK_EVENT, onAsk);
    }, [onOpenChange]);

    // Pages read their data on the server or on their own; both are told that something changed
    const dataChanged = () => {
        router.refresh();
        onDataChanged?.();
        window.dispatchEvent(new CustomEvent('agent:data-changed'));
    };

    const decide = async (message: Message, accept: boolean) => {
        const { actionId, language } = message.reply!;
        setBusyAction(actionId);
        try {
            const outcome = await post<{ applied: boolean; message?: string; result?: { strategy?: { id?: string } } }>('/api/agent/confirm', { actionId, accept, language }, t('errors.apply'));
            patch(message.id, { change: outcome.applied ? 'applied' : 'cancelled', outcome: outcome.message, ...(outcome.result?.strategy?.id ? { strategyId: outcome.result.strategy.id } : {}) });
            setDecidedHere(message.id);
            if (outcome.applied) dataChanged();
            else { router.refresh(); window.dispatchEvent(new CustomEvent(PROPOSAL_CHANGED_EVENT)); }
            if (decisionRef.current.inPlace && message.reply?.preview?.page) {
                // The preview on the page is gone once the change is saved: say so, with a way back
                if (outcome.applied) toast.success(outcome.message || t('preview.saved'), { action: { label: t('preview.undo'), onClick: () => void undoRef.current(message) }, duration: 12000 });
                else toast(t('preview.cancelled'));
            }
        } catch (error) {
            notice(error instanceof Error ? error.message : t('errors.apply'));
        } finally {
            setBusyAction('');
        }
    };

    const undo = async (message: Message) => {
        const { actionId, language } = message.reply!;
        setBusyAction(actionId);
        try {
            const outcome = await post<{ restored: boolean; message?: string }>('/api/agent/undo', { actionId, language }, t('errors.undo'));
            patch(message.id, { change: outcome.restored ? 'undone' : 'applied', outcome: outcome.message });
            if (outcome.restored) dataChanged();
        } catch (error) {
            notice(error instanceof Error ? error.message : t('errors.undo'));
        } finally {
            setBusyAction('');
        }
    };

    // The newest change that belongs on a page and still waits for Save, or that was just decided there (so it can be undone)
    const proposalMessage = useMemo(
        () => [...messages].reverse().find((m) => m.reply?.preview?.page && !dismissed.includes(m.id) && (m.change === 'pending' || m.id === decidedHere)),
        [messages, dismissed, decidedHere],
    );
    const proposalPage = proposalMessage?.reply?.preview?.page;
    const onProposalPage = Boolean(proposalPage && pathname.startsWith(proposalPage));
    const dockKind = ((): DockKind | null => {
        const type = proposalMessage?.reply?.proposedType;
        if (type === 'layout_change') return proposalPage === '/overview' ? 'layout_overview' : 'layout_portfolio';
        return type === 'strategy_propose' || type === 'profile_change' || type === 'rule_create' || type === 'rule_pause' ? type : null;
    })();
    // A layout change that adds or removes a module is previewed on the module itself, which carries Save and Cancel
    // (its decision arrives as an event); the card at the top of the page is for the other changes
    const previewedInPlace = (() => {
        const preview = proposalMessage?.reply?.preview;
        if (proposalMessage?.reply?.proposedType !== 'layout_change' || !Array.isArray(preview?.before) || !Array.isArray(preview?.after)) return false;
        const before = preview.before as string[];
        const after = preview.after as string[];
        return before.some((id) => !after.includes(id)) || after.some((id) => !before.includes(id));
    })();
    const decisionRef = useRef<{ message: Message | undefined; inPlace: boolean }>({ message: undefined, inPlace: false });
    decisionRef.current = { message: proposalMessage, inPlace: previewedInPlace };
    useEffect(() => {
        const onDecide = (event: Event) => {
            const { accept, actionId } = (event as CustomEvent<{ accept?: boolean; actionId?: string }>).detail ?? {};
            const { message } = decisionRef.current;
            if (message?.change === 'pending' && (!actionId || message.reply?.actionId === actionId)) return void decideRef.current(message, Boolean(accept));
            // The conversation is gone (another tab, a new visit) but the proposal is still pending on the server: decide it directly
            if (!actionId) return;
            void (async () => {
                try {
                    const outcome = await post<{ applied: boolean; message?: string }>('/api/agent/confirm', { actionId, accept: Boolean(accept), language: locale }, t('errors.apply'));
                    router.refresh();
                    window.dispatchEvent(new CustomEvent(PROPOSAL_CHANGED_EVENT));
                    if (outcome.applied) window.dispatchEvent(new CustomEvent('agent:data-changed'));
                    toast(outcome.applied ? outcome.message || t('preview.saved') : t('preview.cancelled'));
                } catch (error) {
                    toast.error(error instanceof Error ? error.message : t('errors.apply'));
                    window.dispatchEvent(new CustomEvent(PROPOSAL_CHANGED_EVENT));
                }
            })();
        };
        window.addEventListener(PROPOSAL_DECIDE_EVENT, onDecide);
        return () => window.removeEventListener(PROPOSAL_DECIDE_EVENT, onDecide);
    }, [locale, router, t]);
    const proposalBar = slot && proposalMessage && proposalPage && dockKind && !(previewedInPlace && onProposalPage) ? createPortal(
        <ProposalDock key={proposalMessage.id} kind={dockKind} page={proposalPage} preview={proposalMessage.reply!.preview!}
            change={proposalMessage.change} outcome={proposalMessage.outcome} strategyId={proposalMessage.strategyId}
            withConflict={Boolean(proposalMessage.reply!.conflict)} onPage={onProposalPage} busy={busyAction === proposalMessage.reply!.actionId}
            onSave={() => void decide(proposalMessage, true)} onCancel={() => void decide(proposalMessage, false)} onUndo={() => void undo(proposalMessage)}
            onDismiss={() => setDismissed((list) => [...list, proposalMessage.id])} />,
        slot,
    ) : null;

    const decideRef = useRef(decide);
    decideRef.current = decide;
    const undoRef = useRef(undo);
    undoRef.current = undo;

    const quick = (id: QuickAction) => {
        if (id === 'rule' || id === 'strategy') {
            setDraft(t(`quick.${id}.message`));
            inputRef.current?.focus();
        } else void send(t(`quick.${id}.message`));
    };

    const reset = () => {
        speechRef.current.stop();
        dictated.current = false;
        conversationRun.current += 1;
        setWaiting(false);
        setMessages([]);
        setConversationId(newId());
    };

    if (!open) {
        return (
            <>
                <button type="button" className="btn btn-primary fixed bottom-4 right-4 z-30 rtl:left-4 rtl:right-auto" onClick={() => onOpenChange(true)} aria-expanded={false} aria-controls="agent-panel">
                    <MessageSquareText aria-hidden /> {t('title')}
                </button>
                {proposalBar}
            </>
        );
    }

    return (
        <>
            <div className="fixed inset-0 z-40 bg-page/60 backdrop-blur-[2px] lg:hidden" onClick={() => onOpenChange(false)} />
            <aside
                id="agent-panel"
                aria-label={t('title')}
                className="relative min-h-0 max-lg:fixed max-lg:inset-y-0 max-lg:right-0 max-lg:z-50 max-lg:w-full max-lg:max-w-[420px] max-lg:rtl:left-0 max-lg:rtl:right-auto lg:py-2.5 lg:pe-2.5"
            >
                {/* The inner edge: drag it, or focus it and use the arrow keys. Wide screens only. */}
                <div
                    role="separator" aria-orientation="vertical" tabIndex={0}
                    aria-label={t('resize')} title={t('resizeShort')} aria-valuemin={PANEL_MIN} aria-valuemax={PANEL_MAX} aria-valuenow={width}
                    onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onKeyDown={keyResize}
                    onDoubleClick={() => onResize?.(PANEL_DEFAULT, true)}
                    className="group absolute inset-y-2.5 start-0 z-10 hidden w-3 -translate-x-1/2 cursor-col-resize touch-none items-center justify-center outline-none rtl:translate-x-1/2 lg:flex"
                >
                    <span aria-hidden className="h-12 w-1 rounded-full bg-line-strong transition-colors group-hover:bg-brand group-focus-visible:bg-brand group-active:bg-brand" />
                </div>
                <div className="flex h-full flex-col overflow-hidden bg-card lg:rounded-2xl lg:border lg:border-line">
                    <header className="flex touch-pan-y items-start justify-between gap-2 border-b border-line px-3.5 py-3" onPointerDown={swipeStart} onPointerUp={swipeEnd} onPointerCancel={() => { swipe.current = null; }}>
                        <div className="min-w-0">
                            <p className="kicker">{t('kicker')}</p>
                            <h2 className="section-title">{t('title')}</h2>
                        </div>
                        <div className="flex flex-none gap-1">
                            <SpeakerButton state={speech.state} muted={speech.muted} onToggleMuted={speech.toggleMuted} onStop={speech.stop} />
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
                                                    {message.reply.sources.length === 0 && !message.reply.refused && !message.reply.preview && /\d/.test(message.text) && <p className="mt-2 text-[11px] text-faint">{t('noSource')}</p>}
                                                    {message.reply.conflict && message.reply.conflict.checks.length > 0 && <ConflictBlock conflict={message.reply.conflict} />}
                                                    {message.reply.notice && <p className="mt-2 text-[13px] text-muted-foreground">{message.reply.notice}</p>}
                                                    {message.reply.preview && (
                                                        <PreviewCard message={message} busy={busyAction === message.reply.actionId} onDecide={(accept) => void decide(message, accept)} onUndo={() => void undo(message)} />
                                                    )}
                                                    <Timeline actionId={message.reply.actionId} refreshKey={message.change} />
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
                        <VoiceStatus state={voice.state} error={voice.error} speechFailed={speech.failed} />
                        <form className="flex items-end gap-2" onSubmit={(event) => { event.preventDefault(); submit(); }}>
                            <label htmlFor="agent-input" className="sr-only">{t('inputLabel')}</label>
                            <textarea
                                id="agent-input"
                                ref={inputRef}
                                rows={2}
                                maxLength={2000}
                                readOnly={voice.active}
                                value={draft}
                                onChange={(event) => { setDraft(event.target.value); if (!event.target.value.trim()) dictated.current = false; }}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                                        event.preventDefault();
                                        submit();
                                    }
                                }}
                                placeholder={t('placeholder')}
                                className="min-h-[44px] flex-1 resize-none rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-foreground placeholder:text-faint focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand"
                            />
                            <VoiceButton state={voice.state} support={voice.support} onStart={() => void voice.start()} onStop={voice.stop} />
                            <button type="submit" className="btn btn-primary h-11 px-3" disabled={waiting || !draft.trim()} aria-label={t('send')}><SendHorizontal aria-hidden /></button>
                        </form>
                        <Link href="/logs" className="mt-1.5 inline-block text-[11px] font-semibold text-faint hover:text-foreground hover:underline">{t('logsLink')}</Link>
                    </footer>
                </div>
            </aside>
            {proposalBar}
        </>
    );
};

export default AgentPanel;
