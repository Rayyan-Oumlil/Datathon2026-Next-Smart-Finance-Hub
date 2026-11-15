'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Pause, Play, Plus } from 'lucide-react';
import type { InvestmentRule, Level, SimulatedTrade } from '@/lib/domain/types';
import type { RuleCheck } from '@/lib/services/rules-engine';
import Panel from '@/components/Panel';
import { api, hasNeverWord, money, sourceLine, units, when } from '@/components/portfolio/logic';
import { describeRule } from './describe';
import RuleForm from './RuleForm';

const ORIGIN: Record<SimulatedTrade['origin'], string> = { card: 'Card', rule: 'Rule', agent: 'Agent' };

type Props = {
    rules: InvestmentRule[];
    trades: SimulatedTrade[];
    lastChecked: string | null;
    checks: RuleCheck[];
    checkError: string | null;
    level: Level;
    onChanged: () => void;
};

// Rules live in the app: the engine reads the last quote and, on a hit, simulates a fill. No broker, no real trade.
export default function RulesModule({ rules, trades, lastChecked, checks, checkError, level, onChanged }: Props) {
    const [adding, setAdding] = useState(false);
    const [pending, setPending] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const checkOf = new Map(checks.map((check) => [check.ruleId, check]));
    const ruleOf = new Map(rules.map((rule) => [rule.id, rule]));
    const newestFirst = [...trades].reverse();

    const setStatus = async (rule: InvestmentRule) => {
        setPending(rule.id);
        setError(null);
        try {
            await api('/api/rules', { method: 'PATCH', body: { id: rule.id, status: rule.status === 'active' ? 'paused' : 'active' } });
            onChanged();
        } catch (failure) {
            setError((failure as Error).message);
        } finally {
            setPending(null);
        }
    };

    return (
        <Panel
            className="[&>.section-head]:flex-wrap"
            title="Investment rules (simulated)"
            sub={checkError ?? (lastChecked ? `Last checked ${when(lastChecked)} against the last quotes; checked again every 60 seconds while this tab is open` : 'Checking the rules against the last quotes…')}
            action={!adding && <button type="button" className="btn btn-ghost h-8 flex-none px-3 text-[13px]" onClick={() => setAdding(true)}><Plus /> Add a rule</button>}
            bodyClassName="flex flex-col gap-5 p-4"
        >
            {adding && <RuleForm onCancel={() => setAdding(false)} onSaved={() => { setAdding(false); onChanged(); }} />}
            {error && <p role="alert" className="text-[13px] text-down">{error}</p>}

            <div>
                <h3 className="kicker mb-2">Rules</h3>
                {rules.length === 0 ? (
                    <p className="text-[13.5px] text-faint">No rule yet. A rule watches one asset and, when its trigger is true, simulates a trade at the last price.</p>
                ) : (
                    <ul className="row-list">
                        {rules.map((rule) => {
                            const check = checkOf.get(rule.id);
                            const sentence = describeRule(rule);
                            return (
                                <li key={rule.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                                    <div className="min-w-0 flex-1 basis-64">
                                        <p className="text-[14px] font-semibold text-foreground">{sentence}</p>
                                        {rule.text !== sentence && !hasNeverWord(rule.text) && <p className="text-[12.5px] text-muted-foreground">As written: “{rule.text}”</p>}
                                        <p className="mt-0.5 text-[12px] text-faint">
                                            {level !== 'Novice' && <><span className="mono">{rule.id}</span> · </>}
                                            created {when(rule.createdAt)}
                                            {rule.lastFiredAt ? ` · last acted ${when(rule.lastFiredAt)}` : ' · has not acted yet'}
                                        </p>
                                        {check && (
                                            <p className="mt-0.5 text-[12px] text-faint">
                                                Last check: {check.note}{check.price ? ` (${sourceLine(check.price)})` : ''}
                                            </p>
                                        )}
                                    </div>
                                    <div className="flex flex-none items-center gap-2">
                                        <span className={`pill ${rule.status === 'active' ? 'is-up' : ''}`}>{rule.status}</span>
                                        <button type="button" className="btn btn-ghost h-8 px-3 text-[13px]" disabled={pending === rule.id} onClick={() => setStatus(rule)}>
                                            {rule.status === 'active' ? <><Pause /> Pause</> : <><Play /> Resume</>}
                                        </button>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>

            <div>
                <h3 className="kicker mb-2">Simulated trades</h3>
                {newestFirst.length === 0 ? (
                    <p className="text-[13.5px] text-faint">No simulated trade yet. Each one is listed here with the card or rule that produced it and its reason, and is written to the decision log.</p>
                ) : (
                    <ul className="row-list">
                        {newestFirst.map((trade) => {
                            const rule = trade.ruleId ? ruleOf.get(trade.ruleId) : undefined;
                            return (
                                <li key={trade.id} className="py-3">
                                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px]">
                                        <span className="font-semibold text-foreground">{trade.side === 'buy' ? 'Purchase' : 'Reduction'}</span>
                                        <Link href={`/stocks/${encodeURIComponent(trade.symbol)}`} className="font-bold text-foreground underline-offset-2 outline-none hover:text-brand-ink hover:underline focus-visible:underline">{trade.symbol}</Link>
                                        <span className="num text-muted-foreground">
                                            {level !== 'Novice' && <>{units(trade.quantity)} units at {money(trade.price.value)} {trade.currency} · </>}
                                            {money(trade.valueCad)} CAD
                                        </span>
                                        <span className="pill is-brand">simulated</span>
                                        <span className="pill">{ORIGIN[trade.origin]}</span>
                                    </p>
                                    <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                                        Reason: {trade.reason}
                                        {rule && <> · Rule: {describeRule(rule)}</>}
                                    </p>
                                    <p className="mt-0.5 text-[12px] text-faint">
                                        {when(trade.at)} · fill price: {sourceLine(trade.price)}
                                        {level === 'Expert' && <> · <span className="mono">{trade.id}</span></>}
                                    </p>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </Panel>
    );
}
