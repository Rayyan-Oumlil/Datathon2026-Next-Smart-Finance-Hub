'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Pause, Play, Plus } from 'lucide-react';
import type { InvestmentRule, Level, SimulatedTrade } from '@/lib/domain/types';
import type { RuleCheck } from '@/lib/services/rules-engine';
import Panel from '@/components/Panel';
import { api, hasNeverWord } from '@/components/portfolio/logic';
import { useFmt } from '@/components/portfolio/useFmt';
import { describeRule } from './describe';
import RuleForm from './RuleForm';

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
    const t = useTranslations('Rules');
    const fmt = useFmt();
    const describe = (rule: Parameters<typeof describeRule>[0]) => describeRule(rule, t, fmt.locale);
    const [adding, setAdding] = useState(false);
    const [pending, setPending] = useState<string | null>(null);
    const [error, setError] = useState<{ failure: unknown } | null>(null);
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
            setError({ failure });
        } finally {
            setPending(null);
        }
    };

    return (
        <Panel
            className="[&>.section-head]:flex-wrap"
            title={t('module.title')}
            sub={checkError ?? (lastChecked ? t('module.lastChecked', { when: fmt.when(lastChecked) }) : t('module.checking'))}
            action={!adding && <button type="button" className="btn btn-ghost h-8 flex-none px-3 text-[13px]" onClick={() => setAdding(true)}><Plus /> {t('module.add')}</button>}
            bodyClassName="flex flex-col gap-5 p-4"
        >
            {adding && <RuleForm onCancel={() => setAdding(false)} onSaved={() => { setAdding(false); onChanged(); }} />}
            {error && <p role="alert" className="text-[13px] text-down">{fmt.error(error.failure)}</p>}

            <div>
                <h3 className="kicker mb-2">{t('module.rules')}</h3>
                {rules.length === 0 ? (
                    <p className="text-[13.5px] text-faint">{t('module.noRules')}</p>
                ) : (
                    <ul className="row-list">
                        {rules.map((rule) => {
                            const check = checkOf.get(rule.id);
                            const sentence = describe(rule);
                            return (
                                <li key={rule.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                                    <div className="min-w-0 flex-1 basis-64">
                                        <p className="text-[14px] font-semibold text-foreground">{sentence}</p>
                                        {rule.text !== sentence && !hasNeverWord(rule.text) && <p className="text-[12.5px] text-muted-foreground">{t('module.asWritten', { text: rule.text })}</p>}
                                        <p className="mt-0.5 text-[12px] text-faint">
                                            {level !== 'Novice' && <><span className="mono">{rule.id}</span> · </>}
                                            {t('module.created', { when: fmt.when(rule.createdAt) })}
                                            {' · '}{rule.lastFiredAt ? t('module.lastActed', { when: fmt.when(rule.lastFiredAt) }) : t('module.neverActed')}
                                        </p>
                                        {check && (
                                            <p className="mt-0.5 text-[12px] text-faint">
                                                {check.price ? t('module.lastCheckWithPrice', { note: check.note, source: fmt.sourceLine(check.price) }) : t('module.lastCheck', { note: check.note })}
                                            </p>
                                        )}
                                    </div>
                                    <div className="flex flex-none items-center gap-2">
                                        <span className={`pill ${rule.status === 'active' ? 'is-up' : ''}`}>{t(`status.${rule.status}`)}</span>
                                        <button type="button" className="btn btn-ghost h-8 px-3 text-[13px]" disabled={pending === rule.id} onClick={() => setStatus(rule)}>
                                            {rule.status === 'active' ? <><Pause /> {t('module.pause')}</> : <><Play /> {t('module.resume')}</>}
                                        </button>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>

            <div>
                <h3 className="kicker mb-2">{t('module.trades')}</h3>
                {newestFirst.length === 0 ? (
                    <p className="text-[13.5px] text-faint">{t('module.noTrades')}</p>
                ) : (
                    <ul className="row-list">
                        {newestFirst.map((trade) => {
                            const rule = trade.ruleId ? ruleOf.get(trade.ruleId) : undefined;
                            return (
                                <li key={trade.id} className="py-3">
                                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px]">
                                        <span className="font-semibold text-foreground">{t(`side.${trade.side}`)}</span>
                                        <Link href={`/stocks/${encodeURIComponent(trade.symbol)}`} className="font-bold text-foreground underline-offset-2 outline-none hover:text-brand-ink hover:underline focus-visible:underline">{trade.symbol}</Link>
                                        <span className="num text-muted-foreground">
                                            {level !== 'Novice' && <>{t('module.tradeDetail', { units: t('module.tradeUnits', { count: trade.quantity, quantity: fmt.units(trade.quantity) }), price: fmt.money(trade.price.value), currency: trade.currency })} · </>}
                                            {fmt.cad(trade.valueCad)}
                                        </span>
                                        <span className="pill is-brand">{t('module.simulated')}</span>
                                        <span className="pill">{t(`origin.${trade.origin}`)}</span>
                                    </p>
                                    <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                                        {t('module.reason', { reason: trade.reason })}
                                        {rule && <> · {t('module.ruleRef', { rule: describe(rule) })}</>}
                                    </p>
                                    <p className="mt-0.5 text-[12px] text-faint">
                                        {fmt.when(trade.at)} · {t('module.fillPrice', { line: fmt.sourceLine(trade.price) })}
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
