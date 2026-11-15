'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowUp, EyeOff, Pencil, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { InvestmentRule, Level, ProfileConfig, SimulatedTrade } from '@/lib/domain/types';
import type { PortfolioView } from '@/lib/services/portfolio';
import type { RuleCheck } from '@/lib/services/rules-engine';
import Panel from '@/components/Panel';
import DraftFrame from '@/components/agent/DraftFrame';
import ScrollToDraft from '@/components/agent/ScrollToDraft';
import { useDataChanged } from '@/hooks/useDataChanged';
import { usePendingProposal } from '@/hooks/usePendingProposal';
import type { PendingProposal } from '@/lib/agent/proposal';
import RulesModule from '@/components/rules/RulesModule';
import Holdings from './Holdings';
import PerformanceChart from './PerformanceChart';
import SectorAllocation from './SectorAllocation';
import TotalValue from './TotalValue';
import XrayCard from './xray/XrayCard';
import { PORTFOLIO_MODULES, api, mergeLayout, modulesOf, moveModule, type ModuleId } from './logic';
import { useFmt } from './useFmt';

type LibraryItem = { id: string; title: string; tab: 'portfolio' | 'overview'; fixed: boolean };
type Evaluation = { fired: SimulatedTrade[]; checkedAt: string; checks: RuleCheck[] };

const CHECK_EVERY_MS = 60_000;
const MODULE_IDS: Record<ModuleId, true> = { total_value: true, performance: true, holdings: true, sector_allocation: true, xray: true, investment_rules: true };

// The Portfolio tab: loads the simulated portfolio, draws the modules in the saved order and runs the rules check.
export default function PortfolioBoard() {
    const t = useTranslations('Portfolio');
    const fmt = useFmt();
    const [view, setView] = useState<PortfolioView | null>(null);
    const [rules, setRules] = useState<InvestmentRule[]>([]);
    const [layout, setLayout] = useState<string[]>([]);
    const [library, setLibrary] = useState<LibraryItem[]>([]);
    const [profile, setProfile] = useState<ProfileConfig | null | undefined>(undefined);
    const [error, setError] = useState<{ failure: unknown } | null>(null);
    const [draft, setDraft] = useState<ModuleId[] | null>(null);
    const [saving, setSaving] = useState(false);
    const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
    const [checkError, setCheckError] = useState<{ failure: unknown } | null>(null);
    // A layout change the agent proposed, still waiting for Save: its modules are previewed in place
    const pending = usePendingProposal('/portfolio');
    // After Save, the previewed modules stay on screen until the saved layout has been read: they never drop out and come back
    const [held, setHeld] = useState<PendingProposal | null>(null);
    const proposal = held ?? pending;
    const pendingRef = useRef(pending);
    pendingRef.current = pending;

    const tRef = useRef(t);
    tRef.current = t;

    const refresh = useCallback(async () => {
        try {
            const [portfolio, ruleList] = await Promise.all([
                api<PortfolioView>('/api/portfolio'),
                api<{ rules: InvestmentRule[] }>('/api/rules'),
            ]);
            setView(portfolio);
            setRules(ruleList.rules);
            setError(null);
        } catch (failure) {
            setError({ failure });
        }
    }, []);

    // The saved layout and the profile. When they cannot be read, what is on screen stays (the defaults on a first load).
    const loadSettings = useCallback(() => Promise.all([
        api<{ layout: string[]; library: LibraryItem[] }>('/api/layout')
            .then((saved) => { setLayout(saved.layout); setLibrary(saved.library); })
            .catch(() => setLayout((current) => (current.length > 0 ? current : [...PORTFOLIO_MODULES]))),
        api<{ profile: ProfileConfig | null }>('/api/profile')
            .then((got) => setProfile(got.profile))
            .catch(() => setProfile((current) => current ?? null)),
    ]), []);

    useEffect(() => {
        refresh();
        void loadSettings();
    }, [refresh, loadSettings]);

    // A change saved or undone by the agent (layout, rule, profile, simulated trade): everything is read again in place.
    // The modules stay mounted, so the page keeps its height and its scroll position.
    useDataChanged(() => {
        setHeld(pendingRef.current);
        void Promise.allSettled([refresh(), loadSettings()]).then(() => setHeld(null));
    });

    // The rules engine runs on the server; this tab asks it to check now, then every 60 s while it is visible
    useEffect(() => {
        let stopped = false;
        let first = true;
        const check = async () => {
            if (document.hidden) return;
            const initial = first;
            first = false;
            try {
                const result = await api<Evaluation>('/api/rules/evaluate', { method: 'POST' });
                if (stopped) return;
                setEvaluation(result);
                setCheckError(null);
                if (result.fired.length > 0) {
                    toast.success(tRef.current('board.ruleActed', { count: result.fired.length, symbols: result.fired.map((trade) => trade.symbol).join(', ') }));
                }
                // Prices on screen are never older than one check; the first load has just fetched them
                if (result.fired.length > 0 || !initial) refresh();
            } catch (failure) {
                if (!stopped) setCheckError({ failure });
            }
        };
        check();
        const timer = setInterval(check, CHECK_EVERY_MS);
        return () => {
            stopped = true;
            clearInterval(timer);
        };
    }, [refresh]);

    const level: Level = profile?.level ?? 'Novice';
    const titleOf = (id: string) => (id in MODULE_IDS ? t(`modules.${id}`) : library.find((item) => item.id === id)?.title ?? id);
    // Total value stays fixed even when the library could not be loaded
    const fixed = new Set(['total_value', ...library.filter((item) => item.fixed).map((item) => item.id)]);
    const order = draft ?? modulesOf(layout);
    const hidden = PORTFOLIO_MODULES.filter((id) => !order.includes(id));
    // The modules the proposal would add appear where they would sit, marked as a preview; the ones it would hide stay, dimmed
    const proposedOrder = proposal?.layout ? modulesOf(proposal.layout) : null;
    const previewOrder = (() => {
        if (!proposedOrder || draft) return order;
        if (order.length === proposedOrder.length && order.every((id) => proposedOrder.includes(id))) return proposedOrder;   // only moved
        const merged: ModuleId[] = [...order];
        proposedOrder.forEach((id, i) => {
            if (merged.includes(id)) return;
            const before = proposedOrder[i - 1];
            merged.splice(before ? merged.indexOf(before) + 1 : 0, 0, id);
        });
        return merged;
    })();
    const firstDraft = previewOrder.find((id) => (!proposedOrder || draft ? null : !order.includes(id) ? 'add' : !proposedOrder.includes(id) ? 'remove' : null));
    const draftOf = (id: ModuleId): 'add' | 'remove' | null => (!proposedOrder || draft ? null : !order.includes(id) ? 'add' : !proposedOrder.includes(id) ? 'remove' : null);

    const saveLayout = async () => {
        if (!draft) return;
        setSaving(true);
        try {
            const saved = await api<{ layout: string[] }>('/api/layout', { method: 'PUT', body: { layout: mergeLayout(layout, draft) } });
            setLayout(saved.layout);
            setDraft(null);
            toast.success(t('board.layoutSaved'));
        } catch (failure) {
            toast.error(fmt.error(failure));
        } finally {
            setSaving(false);
        }
    };

    const modules: Record<ModuleId, () => React.ReactNode> = {
        total_value: () => <TotalValue view={view!} level={level} />,
        performance: () => <PerformanceChart history={view!.history} dailyCloses={view!.historyCloses} startingCashCad={view!.portfolio.startingCashCad} note={view!.historyNote} level={level} />,
        holdings: () => <Holdings positions={view!.positions} totalCad={view!.valueCad.value} level={level} onChanged={refresh} />,
        sector_allocation: () => <SectorAllocation bySector={view!.bySector} cashCad={view!.cashCad} totalCad={view!.valueCad.value} unpriced={view!.unpriced} level={level} />,
        xray: () => <XrayCard refreshKey={view!.portfolio.trades.length} />,
        investment_rules: () => (
            <RulesModule
                rules={rules}
                trades={view!.portfolio.trades}
                lastChecked={evaluation?.checkedAt ?? null}
                checks={evaluation?.checks ?? []}
                checkError={checkError ? t('board.checkFailed', { error: fmt.error(checkError.failure) }) : null}
                level={level}
                onChanged={refresh}
            />
        ),
    };

    return (
        <>
            <header className="page-head">
                <div>
                    <h1 className="page-title">{t('title')} <span className="pill is-brand ms-1 align-middle">{t('simulated')}</span></h1>
                    <p className="page-sub">
                        {t('intro')}
                    </p>
                </div>
                {draft ? (
                    <div className="flex gap-2">
                        <button type="button" className="btn btn-ghost" onClick={() => setDraft(null)} disabled={saving}>{t('cancel')}</button>
                        <button type="button" className="btn btn-primary" onClick={saveLayout} disabled={saving}>{saving ? t('board.saving') : t('board.saveLayout')}</button>
                    </div>
                ) : (
                    <button type="button" className="btn btn-ghost" onClick={() => setDraft(modulesOf(layout))} disabled={layout.length === 0}>
                        <Pencil /> {t('board.editLayout')}
                    </button>
                )}
            </header>

            {profile === null && (
                <p className="rounded-[12px] bg-brand-soft px-4 py-3 text-[13.5px] text-foreground">
                    {t.rich('board.noProfile', {
                        link: (chunks) => <Link href="/onboarding" className="font-semibold text-brand-ink underline underline-offset-2">{chunks}</Link>,
                    })}
                </p>
            )}

            {draft && (
                <Panel title={t('board.layoutPanelTitle')} sub={t('board.layoutPanelSub')} bodyClassName="p-2">
                    <ul className="row-list">
                        {draft.map((id, index) => {
                            const locked = fixed.has(id);
                            return (
                                <li key={id} className="flex items-center gap-2 px-2 py-1.5">
                                    <span className="num w-5 flex-none text-[12px] text-faint">{index + 1}</span>
                                    <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-foreground">{titleOf(id)}</span>
                                    {locked ? <span className="pill">{t('board.fixed')}</span> : (
                                        <>
                                            <button type="button" className="icon-btn" aria-label={t('board.moveUp', { title: titleOf(id) })} disabled={moveModule(draft, id, -1, fixed) === draft} onClick={() => setDraft(moveModule(draft, id, -1, fixed))}><ArrowUp /></button>
                                            <button type="button" className="icon-btn" aria-label={t('board.moveDown', { title: titleOf(id) })} disabled={moveModule(draft, id, 1, fixed) === draft} onClick={() => setDraft(moveModule(draft, id, 1, fixed))}><ArrowDown /></button>
                                            <button type="button" className="icon-btn" aria-label={t('board.hide', { title: titleOf(id) })} onClick={() => setDraft(draft.filter((other) => other !== id))}><EyeOff /></button>
                                        </>
                                    )}
                                </li>
                            );
                        })}
                        {hidden.map((id) => (
                            <li key={id} className="flex items-center gap-2 px-2 py-1.5">
                                <span className="w-5 flex-none" />
                                <span className="min-w-0 flex-1 truncate text-[14px] text-faint">{titleOf(id)} <span className="text-[12px]">{t('board.hiddenTag')}</span></span>
                                <button type="button" className="btn btn-ghost h-8 px-3 text-[13px]" onClick={() => setDraft([...draft, id])}><Plus /> {t('board.show')}</button>
                            </li>
                        ))}
                    </ul>
                </Panel>
            )}

            {error && (
                <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-line bg-card px-4 py-3 text-[13.5px] text-down">
                    <span>{t('board.loadError', { error: fmt.error(error.failure) })}</span>
                    <button type="button" className="btn btn-ghost h-8 px-3 text-[13px]" onClick={refresh}>{t('board.tryAgain')}</button>
                </div>
            )}

            {!view ? (
                !error && <div className="hatch" aria-busy="true"><div className="card p-5 text-[13.5px] text-faint">{t('board.loading')}</div></div>
            ) : (
                <>
                    {view.portfolio.trades.length === 0 && (
                        <p className="rounded-[12px] border border-line bg-card px-4 py-3 text-[13.5px] text-muted-foreground">
                            {t.rich('board.newHere', {
                                link: (chunks) => <Link href="/overview" className="font-semibold text-brand-ink underline underline-offset-2">{chunks}</Link>,
                            })}
                        </p>
                    )}
                    {proposal && proposedOrder && <ScrollToDraft id={proposal.actionId} />}
                    {previewOrder.map((id) => <DraftFrame key={id} state={draftOf(id)} primary={id === firstDraft} actionId={proposal?.actionId} labels={{ add: t('draft.add'), remove: t('draft.remove'), cancel: t('draft.cancel'), save: t('draft.save') }}><div>{modules[id]()}</div></DraftFrame>)}
                </>
            )}
        </>
    );
}
