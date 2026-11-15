'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Briefcase, ChevronRight, MessageSquareText, Plus, Save, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { askAgent } from '@/lib/agent/page-detail';
import { api } from '@/components/portfolio/logic';
import { useFmt } from '@/components/portfolio/useFmt';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { formatDateTime } from '@/i18n/format';
import { LIMITS, type AllocationTarget, type RuleKind, type StrategyRule } from '@/lib/strategy/types';
import HistoryPreview from './HistoryPreview';
import { ApiIssues } from './issues';
import LiveCheck from './LiveCheck';
import { byPriority, defaultRule, PRIORITY, ruleIndexOf, sameDraft, targetsFromHoldings, toInput, type Holding, type ServerIssue, type StoredStrategy, type StrategyDraft } from './model';
import { KIND_ICON, RuleCard } from './RuleCard';
import { OrderNote } from './StrategySummary';
import { FIELD } from './Chip';

type PortfolioInfo = { holdings: Holding[]; cashCad: number; valueCad: number | null };
type PortfolioResponse = {
    cashCad: number;
    valueCad: { value: number } | null;
    positions: Array<{ symbol: string; quantity: number; avgCostCad: number; valueCad: number | null; price: { value: number } | null }>;
};

const Card = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
    <div className="hatch"><div className={`card p-4 ${className}`}>{children}</div></div>
);

// The manual strategy builder: the visitor's strategies as cards, then one strategy edited as a list of rule
// sentences with clickable values, saved through POST /api/strategy, checked today and previewed on history.
export default function StrategyBuilder() {
    const t = useTranslations('Strategy');
    const locale = useLocale();
    const fmt = useFmt();
    const router = useRouter();
    const params = useSearchParams();
    const openId = params.get('id');

    const [strategies, setStrategies] = useState<StoredStrategy[] | null>(null);
    const [portfolio, setPortfolio] = useState<PortfolioInfo | null>(null);
    const [loadError, setLoadError] = useState<unknown>(null);

    const load = useCallback(async () => {
        setLoadError(null);
        try {
            const [list, view] = await Promise.all([
                api<{ strategies: StoredStrategy[] }>('/api/strategy'),
                api<PortfolioResponse>('/api/portfolio'),
            ]);
            setStrategies(list.strategies);
            setPortfolio({
                cashCad: view.cashCad,
                valueCad: view.valueCad?.value ?? null,
                holdings: view.positions.map((p) => ({ symbol: p.symbol, valueCad: p.valueCad ?? p.quantity * p.avgCostCad, price: p.price?.value ?? null })),
            });
        } catch (failure) {
            setLoadError(failure);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);
    // The agent can create or change a strategy: read the list again when it says something changed
    useEffect(() => {
        const onChange = () => { void api<{ strategies: StoredStrategy[] }>('/api/strategy').then((list) => setStrategies(list.strategies)).catch(() => undefined); };
        window.addEventListener('agent:data-changed', onChange);
        return () => window.removeEventListener('agent:data-changed', onChange);
    }, []);

    const open = (id: string | null) => router.push(id ? `/strategy?id=${encodeURIComponent(id)}` : '/strategy', { scroll: true });

    const head = (
        <header className="page-head">
            <div>
                <h1 className="page-title">{t('title')} <span className="pill is-brand ms-1 align-middle tracking-normal [word-spacing:normal]">{t('simulated')}</span></h1>
                <p className="page-sub max-w-2xl">{t('sub')}</p>
            </div>
        </header>
    );

    if (loadError && !strategies) {
        return (
            <div className="flex flex-col gap-4">
                {head}
                <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-line bg-card px-4 py-3 text-[13.5px] text-down">
                    <span>{t('loadError', { error: fmt.error(loadError) })}</span>
                    <button type="button" className="btn btn-ghost h-8 px-3 text-[13px]" onClick={load}>{t('retry')}</button>
                </div>
            </div>
        );
    }
    if (!strategies || !portfolio) {
        return (
            <div className="flex flex-col gap-4" aria-busy="true">
                {head}
                <p className="text-[13.5px] text-faint">{t('loading')}</p>
            </div>
        );
    }
    if (portfolio.holdings.length === 0) {
        return (
            <div className="flex flex-col gap-4">
                {head}
                <Card>
                    <div className="empty-state">
                        <span className="empty-icon"><Briefcase className="size-5" /></span>
                        <h3>{t('noPortfolio.title')}</h3>
                        <p className="max-w-md text-[13.5px]">{t('noPortfolio.body')}</p>
                        <Link href="/start" className="btn btn-primary mt-3">{t('noPortfolio.cta')}<ChevronRight /></Link>
                    </div>
                </Card>
            </div>
        );
    }

    const selected = openId ? strategies.find((s) => s.id === openId) : undefined;
    if (selected) {
        return (
            <StrategyEditor
                key={selected.id}
                stored={selected}
                portfolio={portfolio}
                onBack={() => open(null)}
                onSaved={(saved) => setStrategies((list) => (list ?? []).some((s) => s.id === saved.id) ? (list ?? []).map((s) => (s.id === saved.id ? saved : s)) : [...(list ?? []), saved])}
            />
        );
    }

    return (
        <div className="flex flex-col gap-4">
            {head}
            <StrategyList
                strategies={strategies}
                locale={locale}
                onOpen={open}
                onCreated={(saved) => { setStrategies([...strategies, saved]); open(saved.id); }}
                onRemoved={(id) => setStrategies((list) => (list ?? []).filter((s) => s.id !== id))}
            />
        </div>
    );
}

function StrategyList({ strategies, locale, onOpen, onCreated, onRemoved }: { strategies: StoredStrategy[]; locale: string; onOpen: (id: string) => void; onCreated: (saved: StoredStrategy) => void; onRemoved: (id: string) => void }) {
    const t = useTranslations('Strategy');
    const fmt = useFmt();
    const [creating, setCreating] = useState(false);
    const [name, setName] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const create = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!name.trim()) { setError(t('editor.nameRequired')); return; }
        setBusy(true);
        setError(null);
        try {
            const { strategy } = await api<{ strategy: StoredStrategy }>('/api/strategy', { method: 'POST', body: { strategy: { name: name.trim(), rules: [] } } });
            onCreated(strategy);
        } catch (failure) {
            setError(fmt.error(failure));
            setBusy(false);
        }
    };

    const sorted = [...strategies].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return (
        <section className="grid gap-3">
            <div className="section-head !px-1">
                <div>
                    <h2 className="section-title">{t('list.title')}</h2>
                    <p className="section-sub">{t('list.sub')}</p>
                </div>
                {!creating && <button type="button" className="btn btn-primary h-9 px-4 text-[13px]" onClick={() => setCreating(true)}><Plus />{t('list.new')}</button>}
            </div>

            {creating && (
                <Card>
                    <form onSubmit={create} className="flex flex-wrap items-end gap-2">
                        <label className="grid min-w-[14rem] flex-1 gap-1.5">
                            <span className="form-label">{t('list.nameLabel')}</span>
                            <input autoFocus className={`${FIELD} h-10`} value={name} maxLength={LIMITS.nameMax} onChange={(e) => setName(e.target.value)} placeholder={t('list.namePlaceholder')} />
                        </label>
                        <button type="button" className="btn btn-ghost h-10" onClick={() => { setCreating(false); setError(null); }}>{t('list.cancel')}</button>
                        <button type="submit" className="btn btn-primary h-10" disabled={busy}>{t('list.create')}</button>
                    </form>
                    {error && <p role="alert" className="mt-2 text-[13px] text-down">{error}</p>}
                </Card>
            )}

            {sorted.length === 0 && !creating ? (
                <Card><p className="py-6 text-center text-[13.5px] text-faint">{t('list.empty')}</p></Card>
            ) : (
                <ul className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,17rem),1fr))]">
                    {sorted.map((strategy) => {
                        const kinds = [...new Set(byPriority(strategy.rules).map((rule) => rule.kind))];
                        return (
                            <li key={strategy.id} className="hatch relative">
                                <RemoveStrategy strategy={strategy} onRemoved={onRemoved} />
                                <button type="button" onClick={() => onOpen(strategy.id)} className="card flex h-full w-full flex-col gap-2 p-4 text-start outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring/40">
                                    <span className="pe-9 text-[15px] font-bold text-foreground">{strategy.name}</span>
                                    <span className="text-[12.5px] text-faint">{t('list.rules', { count: strategy.rules.length })} · {t('list.updated', { date: formatDateTime(strategy.updatedAt, locale, { dateStyle: 'medium' }) })}</span>
                                    <span className="mt-auto flex flex-wrap gap-1 pt-1">
                                        {kinds.map((kind) => {
                                            const Icon = KIND_ICON[kind];
                                            return <span key={kind} className="pill"><Icon />{t(`kinds.${kind}.name`)}</span>;
                                        })}
                                        <span className="ms-auto inline-flex items-center gap-1 text-[12.5px] font-bold text-brand-ink">{t('list.open')}<ChevronRight className="size-3.5" /></span>
                                    </span>
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </section>
    );
}

/** "Supprimer" on a strategy card, with a confirm step: DELETE /api/strategy?id=... (the removal is logged server-side). */
function RemoveStrategy({ strategy, onRemoved }: { strategy: StoredStrategy; onRemoved: (id: string) => void }) {
    const t = useTranslations('Strategy');
    const fmt = useFmt();
    const [confirming, setConfirming] = useState(false);
    const [busy, setBusy] = useState(false);

    const remove = async () => {
        setBusy(true);
        try {
            await api(`/api/strategy?id=${encodeURIComponent(strategy.id)}`, { method: 'DELETE' });
            toast.success(t('list.removed', { name: strategy.name }));
            onRemoved(strategy.id);
        } catch (failure) {
            toast.error(fmt.error(failure));
            setBusy(false);
            setConfirming(false);
        }
    };

    if (!confirming) {
        return (
            <button type="button" className="icon-btn absolute end-2 top-2 z-10" onClick={() => setConfirming(true)} aria-label={t('list.remove')} title={t('list.remove')}>
                <Trash2 />
            </button>
        );
    }
    return (
        <div role="alertdialog" aria-label={t('list.removeConfirm', { name: strategy.name })} className="absolute inset-x-2 top-2 z-10 flex flex-wrap items-center gap-2 rounded-[10px] border border-line bg-card p-2 shadow-sm">
            <span className="min-w-0 flex-1 text-[12.5px] font-semibold text-foreground">{t('list.removeConfirm', { name: strategy.name })}</span>
            <button type="button" className="btn btn-ghost h-8 px-3 text-[12.5px]" onClick={() => setConfirming(false)} disabled={busy}>{t('list.removeNo')}</button>
            <button type="button" className="btn btn-primary h-8 px-3 text-[12.5px]" onClick={() => void remove()} disabled={busy} autoFocus>{t('list.removeYes')}</button>
        </div>
    );
}

function StrategyEditor({ stored, portfolio, onBack, onSaved }: { stored: StoredStrategy; portfolio: PortfolioInfo; onBack: () => void; onSaved: (saved: StoredStrategy) => void }) {
    const t = useTranslations('Strategy');
    const fmt = useFmt();
    const fromStored = (s: StoredStrategy): StrategyDraft => ({ id: s.id, name: s.name, rules: byPriority(s.rules), version: s.version });
    const [baseline, setBaseline] = useState<StrategyDraft>(() => fromStored(stored));
    const [draft, setDraft] = useState<StrategyDraft>(() => fromStored(stored));
    const [busy, setBusy] = useState(false);
    const [issues, setIssues] = useState<ServerIssue[]>([]);
    const [failure, setFailure] = useState<string | null>(null);
    const [adding, setAdding] = useState(false);

    const dirty = !sameDraft(draft, baseline);
    const holdings = useMemo(() => [...portfolio.holdings].sort((a, b) => b.valueCad - a.valueCad).map((h) => h.symbol), [portfolio]);
    const currentTargets: AllocationTarget[] = useMemo(() => targetsFromHoldings(portfolio.holdings, portfolio.cashCad), [portfolio]);

    const ruleLabel = (ruleId: string) => {
        const at = draft.rules.findIndex((rule) => rule.id === ruleId);
        if (at < 0) return ruleId;
        return `${t('editor.ruleNumber', { n: at + 1 })} · ${t(`kinds.${draft.rules[at].kind}.name`)}`;
    };

    // The server's issues belong to the rules as they were sent: once a rule changes they are out of date
    const setRules = (rules: StrategyRule[]) => { setDraft((d) => ({ ...d, rules: byPriority(rules) })); setIssues([]); };
    const addRule = (kind: RuleKind) => {
        setRules([...draft.rules, defaultRule(kind, portfolio.holdings, currentTargets)]);
        setAdding(false);
    };

    /** Saves when something changed; answers the stored id, or null when the server refused the strategy. */
    const save = async (): Promise<string | null> => {
        if (!dirty && draft.id) return draft.id;
        if (!draft.name.trim()) { setFailure(t('editor.nameRequired')); return null; }
        setBusy(true);
        setIssues([]);
        setFailure(null);
        try {
            const res = await fetch('/api/strategy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', body: JSON.stringify({ strategy: toInput(draft) }) });
            const json = await res.json().catch(() => null);
            if (!res.ok) {
                const list: ServerIssue[] = Array.isArray(json?.issues) ? json.issues : [];
                setIssues(list);
                if (list.length === 0) setFailure(typeof json?.error === 'string' ? json.error : fmt.error(null));
                return null;
            }
            const saved = (json as { strategy: StoredStrategy }).strategy;
            const next = fromStored(saved);
            setBaseline(next);
            setDraft(next);
            onSaved(saved);
            toast.success(t('editor.saved'));
            return saved.id;
        } catch (error) {
            setFailure(fmt.error(error));
            return null;
        } finally {
            setBusy(false);
        }
    };

    // Next to its rule, a sentence does not need the technical place it starts with ("rules.1.movePct : …")
    const issuesOf = (index: number) => issues.filter((issue) => ruleIndexOf(issue.path) === index).map((issue) => {
        const text = issue.message.startsWith(issue.path) ? issue.message.slice(issue.path.length).replace(/^\s*:\s*/, '') : issue.message;
        return text.charAt(0).toUpperCase() + text.slice(1);
    });
    const general = issues.filter((issue) => ruleIndexOf(issue.path) === null);

    const ask = () => {
        const rules = draft.rules.length > 0 ? draft.rules.map((rule) => t(`kinds.${rule.kind}.name`)).join(', ') : t('editor.askAgentEmpty');
        askAgent(t('editor.askAgentMessage', { name: draft.name.trim() || stored.name, count: draft.rules.length, rules }));
    };

    return (
        <div className="@container flex flex-col gap-4">
            <header className="page-head">
                <div className="min-w-[min(100%,18rem)] flex-1">
                    <button type="button" onClick={onBack} className="mb-2 inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />{t('editor.back')}</button>
                    <label className="grid gap-1">
                        <span className="sr-only">{t('editor.nameLabel')}</span>
                        <input
                            className="page-title w-full min-w-0 rounded-[8px] bg-transparent px-1 -mx-1 outline-none hover:bg-hover focus-visible:bg-hover focus-visible:ring-2 focus-visible:ring-ring/30"
                            value={draft.name}
                            maxLength={LIMITS.nameMax}
                            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                            aria-label={t('editor.nameLabel')}
                        />
                    </label>
                    <p className="page-sub text-[13px]">
                        {dirty ? <span className="font-semibold text-warn">{t('editor.unsaved')}</span> : draft.id ? t('editor.upToDate', { version: draft.version ?? 1 }) : t('editor.notYetSaved')}
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <button type="button" className="btn btn-ghost h-9 px-4 text-[13px]" onClick={ask}><MessageSquareText />{t('editor.askAgent')}</button>
                    <button type="button" className="btn btn-primary h-9 px-4 text-[13px]" onClick={() => void save()} disabled={busy || !dirty}><Save />{busy ? t('editor.saving') : t('editor.save')}</button>
                </div>
            </header>

            {(general.length > 0 || failure) && (
                <ApiIssues title={t('editor.issuesTitle')} message={failure ?? undefined} issues={general} />
            )}
            {issues.length > 0 && general.length === 0 && !failure && <p role="alert" className="px-1 text-[13px] font-semibold text-down">{t('editor.issuesTitle')} {t('editor.issuesBelow')}</p>}

            <div className="grid items-start gap-4 @4xl:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)]">
                <section className="grid gap-3">
                    {draft.rules.length === 0 && (
                        <div className="hatch"><div className="card px-4 py-6 text-center text-[13.5px] text-faint">{t('editor.noRules')}</div></div>
                    )}
                    {draft.rules.map((rule, index) => (
                        <div key={rule.id} className="hatch">
                            <RuleCard
                                rule={rule}
                                position={index + 1}
                                issues={issuesOf(index)}
                                edit={{
                                    holdings,
                                    currentTargets,
                                    onChange: (next) => setRules(draft.rules.map((r) => (r.id === rule.id ? next : r))),
                                    onRemove: () => setRules(draft.rules.filter((r) => r.id !== rule.id)),
                                }}
                            />
                        </div>
                    ))}

                    <Popover open={adding} onOpenChange={setAdding}>
                        <PopoverTrigger asChild>
                            <button type="button" className="btn btn-ghost h-11 w-full border-dashed text-[13.5px]" disabled={draft.rules.length >= LIMITS.rulesMax}>
                                <Plus />{t('editor.addRule')}
                            </button>
                        </PopoverTrigger>
                        <PopoverContent align="start" className="w-[min(26rem,calc(100vw-2rem))] rounded-[12px] border-line bg-card p-2 text-foreground">
                            <p className="form-label px-2 pb-1.5 pt-1">{t('editor.addRuleTitle')}</p>
                            <ul className="grid gap-0.5">
                                {PRIORITY.map((kind) => {
                                    const Icon = KIND_ICON[kind];
                                    return (
                                        <li key={kind}>
                                            <button type="button" onClick={() => addRule(kind)} className="flex w-full items-start gap-2.5 rounded-[9px] px-2 py-2 text-start outline-none hover:bg-hover focus-visible:bg-hover">
                                                <span className="bento-ico mt-0.5"><Icon /></span>
                                                <span className="grid gap-0.5">
                                                    <span className="text-[13.5px] font-bold text-foreground">{t(`kinds.${kind}.name`)}</span>
                                                    <span className="text-[12.5px] leading-snug text-muted-foreground">{t(`kinds.${kind}.desc`)}</span>
                                                </span>
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        </PopoverContent>
                    </Popover>
                    {draft.rules.length >= LIMITS.rulesMax && <p className="text-[12.5px] text-faint">{t('editor.rulesMax', { max: LIMITS.rulesMax })}</p>}
                    <OrderNote className="px-1" />
                </section>

                <aside className="grid gap-4">
                    <LiveCheck ensureSaved={save} disabled={busy || draft.rules.length === 0} ruleLabel={ruleLabel} stamp={JSON.stringify(draft.rules)} />
                    <HistoryPreview strategy={draft} savedId={!dirty && draft.id ? draft.id : null} capitalCad={portfolio.valueCad} ruleLabel={ruleLabel} />
                </aside>
            </div>
        </div>
    );
}
