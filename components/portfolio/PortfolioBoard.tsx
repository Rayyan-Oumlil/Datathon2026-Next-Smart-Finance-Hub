'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowUp, EyeOff, Pencil, Plus } from 'lucide-react';
import { toast } from 'sonner';
import type { InvestmentRule, Level, ProfileConfig, SimulatedTrade } from '@/lib/domain/types';
import type { PortfolioView } from '@/lib/services/portfolio';
import type { RuleCheck } from '@/lib/services/rules-engine';
import Panel from '@/components/Panel';
import RulesModule from '@/components/rules/RulesModule';
import Holdings from './Holdings';
import PerformanceChart from './PerformanceChart';
import SectorAllocation from './SectorAllocation';
import TotalValue from './TotalValue';
import { PORTFOLIO_MODULES, api, mergeLayout, modulesOf, moveModule, type ModuleId } from './logic';

type LibraryItem = { id: string; title: string; tab: 'portfolio' | 'overview'; fixed: boolean };
type Evaluation = { fired: SimulatedTrade[]; checkedAt: string; checks: RuleCheck[] };

const CHECK_EVERY_MS = 60_000;

// The Portfolio tab: loads the simulated portfolio, draws the modules in the saved order and runs the rules check.
export default function PortfolioBoard() {
    const [view, setView] = useState<PortfolioView | null>(null);
    const [rules, setRules] = useState<InvestmentRule[]>([]);
    const [layout, setLayout] = useState<string[]>([]);
    const [library, setLibrary] = useState<LibraryItem[]>([]);
    const [profile, setProfile] = useState<ProfileConfig | null | undefined>(undefined);
    const [error, setError] = useState<string | null>(null);
    const [draft, setDraft] = useState<ModuleId[] | null>(null);
    const [saving, setSaving] = useState(false);
    const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
    const [checkError, setCheckError] = useState<string | null>(null);

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
            setError((failure as Error).message);
        }
    }, []);

    useEffect(() => {
        refresh();
        api<{ layout: string[]; library: LibraryItem[] }>('/api/layout')
            .then((saved) => { setLayout(saved.layout); setLibrary(saved.library); })
            .catch(() => setLayout([...PORTFOLIO_MODULES]));
        api<{ profile: ProfileConfig | null }>('/api/profile')
            .then((got) => setProfile(got.profile))
            .catch(() => setProfile(null));
    }, [refresh]);

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
                    toast.success(`${result.fired.length === 1 ? 'A rule' : `${result.fired.length} rules`} acted: ${result.fired.map((trade) => trade.symbol).join(', ')} (simulated).`);
                }
                // Prices on screen are never older than one check; the first load has just fetched them
                if (result.fired.length > 0 || !initial) refresh();
            } catch (failure) {
                if (!stopped) setCheckError(`The rules check did not run: ${(failure as Error).message}`);
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
    const titleOf = (id: string) => library.find((item) => item.id === id)?.title ?? id;
    // Total value stays fixed even when the library could not be loaded
    const fixed = new Set(['total_value', ...library.filter((item) => item.fixed).map((item) => item.id)]);
    const order = draft ?? modulesOf(layout);
    const hidden = PORTFOLIO_MODULES.filter((id) => !order.includes(id));

    const saveLayout = async () => {
        if (!draft) return;
        setSaving(true);
        try {
            const saved = await api<{ layout: string[] }>('/api/layout', { method: 'PUT', body: { layout: mergeLayout(layout, draft) } });
            setLayout(saved.layout);
            setDraft(null);
            toast.success('Layout saved.');
        } catch (failure) {
            toast.error((failure as Error).message);
        } finally {
            setSaving(false);
        }
    };

    const modules: Record<ModuleId, () => React.ReactNode> = {
        total_value: () => <TotalValue view={view!} level={level} />,
        performance: () => <PerformanceChart history={view!.history} startingCashCad={view!.portfolio.startingCashCad} note={view!.historyNote} level={level} />,
        holdings: () => <Holdings positions={view!.positions} totalCad={view!.valueCad.value} level={level} onChanged={refresh} />,
        sector_allocation: () => <SectorAllocation bySector={view!.bySector} cashCad={view!.cashCad} totalCad={view!.valueCad.value} unpriced={view!.unpriced} level={level} />,
        investment_rules: () => (
            <RulesModule
                rules={rules}
                trades={view!.portfolio.trades}
                lastChecked={evaluation?.checkedAt ?? null}
                checks={evaluation?.checks ?? []}
                checkError={checkError}
                level={level}
                onChanged={refresh}
            />
        ),
    };

    return (
        <>
            <header className="page-head">
                <div>
                    <h1 className="page-title">Portfolio <span className="pill is-brand ms-1 align-middle">simulated</span></h1>
                    <p className="page-sub">
                        A practice portfolio that starts with a fixed amount of simulated cash. No real trade is placed and nothing here is investment advice.
                    </p>
                </div>
                {draft ? (
                    <div className="flex gap-2">
                        <button type="button" className="btn btn-ghost" onClick={() => setDraft(null)} disabled={saving}>Cancel</button>
                        <button type="button" className="btn btn-primary" onClick={saveLayout} disabled={saving}>{saving ? 'Saving…' : 'Save layout'}</button>
                    </div>
                ) : (
                    <button type="button" className="btn btn-ghost" onClick={() => setDraft(modulesOf(layout))} disabled={layout.length === 0}>
                        <Pencil /> Edit layout
                    </button>
                )}
            </header>

            {profile === null && (
                <p className="rounded-[12px] bg-brand-soft px-4 py-3 text-[13.5px] text-foreground">
                    No profile exists yet, so this tab uses the plain-words view and simulated trades are off until the{' '}
                    <Link href="/onboarding" className="font-semibold text-brand-ink underline underline-offset-2">profile questions</Link> are answered.
                </p>
            )}

            {draft && (
                <Panel title="Edit layout" sub="Order and visibility of the modules on this tab. Nothing changes until you save." bodyClassName="p-2">
                    <ul className="row-list">
                        {draft.map((id, index) => {
                            const locked = fixed.has(id);
                            return (
                                <li key={id} className="flex items-center gap-2 px-2 py-1.5">
                                    <span className="num w-5 flex-none text-[12px] text-faint">{index + 1}</span>
                                    <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-foreground">{titleOf(id)}</span>
                                    {locked ? <span className="pill">fixed</span> : (
                                        <>
                                            <button type="button" className="icon-btn" aria-label={`Move ${titleOf(id)} up`} disabled={moveModule(draft, id, -1, fixed) === draft} onClick={() => setDraft(moveModule(draft, id, -1, fixed))}><ArrowUp /></button>
                                            <button type="button" className="icon-btn" aria-label={`Move ${titleOf(id)} down`} disabled={moveModule(draft, id, 1, fixed) === draft} onClick={() => setDraft(moveModule(draft, id, 1, fixed))}><ArrowDown /></button>
                                            <button type="button" className="icon-btn" aria-label={`Hide ${titleOf(id)}`} onClick={() => setDraft(draft.filter((other) => other !== id))}><EyeOff /></button>
                                        </>
                                    )}
                                </li>
                            );
                        })}
                        {hidden.map((id) => (
                            <li key={id} className="flex items-center gap-2 px-2 py-1.5">
                                <span className="w-5 flex-none" />
                                <span className="min-w-0 flex-1 truncate text-[14px] text-faint">{titleOf(id)} <span className="text-[12px]">(hidden)</span></span>
                                <button type="button" className="btn btn-ghost h-8 px-3 text-[13px]" onClick={() => setDraft([...draft, id])}><Plus /> Show</button>
                            </li>
                        ))}
                    </ul>
                </Panel>
            )}

            {error && (
                <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-line bg-card px-4 py-3 text-[13.5px] text-down">
                    <span>The simulated portfolio could not be loaded: {error}</span>
                    <button type="button" className="btn btn-ghost h-8 px-3 text-[13px]" onClick={refresh}>Try again</button>
                </div>
            )}

            {!view ? (
                !error && <div className="hatch" aria-busy="true"><div className="card p-5 text-[13.5px] text-faint">Loading the simulated portfolio and the last prices…</div></div>
            ) : (
                <>
                    {view.portfolio.trades.length === 0 && (
                        <p className="rounded-[12px] border border-line bg-card px-4 py-3 text-[13.5px] text-muted-foreground">
                            New here: the simulated portfolio is all cash. Open the{' '}
                            <Link href="/overview" className="font-semibold text-brand-ink underline underline-offset-2">Overview tab</Link>
                            {' '}to see the watchlist built from your profile and add a first simulated position.
                        </p>
                    )}
                    {order.map((id) => <div key={id}>{modules[id]()}</div>)}
                </>
            )}
        </>
    );
}
