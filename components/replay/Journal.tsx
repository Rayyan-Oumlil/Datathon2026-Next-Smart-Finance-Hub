'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { AssetLogo } from '@/components/AssetLogo';
import type { ReplayOrder, ReplayResult } from '@/lib/replay/engine/types';
import { ruleColor, ruleIndex, ruleName } from './rules';
import { useReplayFmt } from './useReplayFmt';

type Props = {
    result: ReplayResult;
    eventOfOrder: Map<string, number>;
    selected: number | null;
    onSelect: (eventIndex: number | null) => void;
};

// The simulated orders of the "with" series, in date order: decision day, execution day, the deterministic sentence,
// quantity, price and fee. The starting orders are folded by default; a row selects its rule event (and the other
// way round: the selected event's rows are highlighted and scrolled into view).
export default function Journal({ result, eventOfOrder, selected, onSelect }: Props) {
    const t = useTranslations('Replay');
    const f = useReplayFmt();
    const [filter, setFilter] = useState<string>('all');
    const [showInitial, setShowInitial] = useState(false);
    const box = useRef<HTMLDivElement>(null);
    const colors = useMemo(() => ruleIndex(result), [result]);

    const orders = useMemo(() => result.orders.filter((o) => o.series === 'with'), [result]);
    const initial = orders.filter((o) => o.ruleId === null);
    const ruled = orders.filter((o) => o.ruleId !== null && (filter === 'all' || o.ruleId === filter));
    const rules = result.params.strategy.rules;

    // keep the selected event's first row in view, inside the journal only
    useEffect(() => {
        if (selected === null || !box.current) return;
        const row = box.current.querySelector<HTMLTableRowElement>(`tr[data-event="${selected}"]`);
        if (!row) return;
        const top = row.offsetTop - box.current.clientHeight / 3;
        box.current.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }, [selected]);

    const row = (o: ReplayOrder) => {
        const eventIndex = eventOfOrder.get(o.id);
        const isOn = eventIndex !== undefined && eventIndex === selected;
        return (
            <tr
                key={o.id}
                data-event={eventIndex}
                onClick={() => eventIndex !== undefined && onSelect(eventIndex === selected ? null : eventIndex)}
                className={eventIndex !== undefined ? 'cursor-pointer' : ''}
                aria-selected={isOn}
            >
                <td className={`!h-auto py-2 align-top ${isOn ? '!bg-brand-soft' : ''}`}>
                    <span className="flex items-center gap-1.5">
                        {o.ruleId && <span className="inline-block size-2 flex-none rotate-45 rounded-[2px]" style={{ background: ruleColor(colors.get(o.ruleId) ?? 0) }} />}
                        {f.date(o.decisionDay)}
                    </span>
                </td>
                <td className={`!h-auto py-2 align-top ${isOn ? '!bg-brand-soft' : ''}`}>{f.date(o.executionDay)}</td>
                <td className={`!h-auto min-w-[320px] !whitespace-normal py-2 align-top text-foreground ${isOn ? '!bg-brand-soft' : ''}`}>
                    <span className="flex items-start gap-2"><AssetLogo symbol={o.symbol} size={20} className="mt-px flex-none" /><span className="min-w-0">{o.sentence[f.locale]}</span></span>
                </td>
                <td className={`is-num !h-auto py-2 align-top ${isOn ? '!bg-brand-soft' : ''}`}>{f.qty(o.quantity)}</td>
                <td className={`is-num !h-auto py-2 align-top ${isOn ? '!bg-brand-soft' : ''}`}>{f.money(o.priceCad, 2)}</td>
                <td className={`is-num !h-auto py-2 align-top ${isOn ? '!bg-brand-soft' : ''}`}>{f.money(o.feeCad, 2)}</td>
            </tr>
        );
    };

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[12.5px] text-faint">{t('journal.count', { count: orders.length - initial.length, initial: initial.length })}</p>
                {rules.length > 0 && (
                    <label className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
                        {t('journal.filter')}
                        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="h-8 rounded-[9px] border border-line bg-card px-2 text-[12.5px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
                            <option value="all">{t('journal.allRules')}</option>
                            {rules.map((r) => <option key={r.id} value={r.id}>{ruleName(t, result, r.id)}</option>)}
                        </select>
                    </label>
                )}
            </div>
            <div ref={box} className="relative max-h-[420px] overflow-auto rounded-[10px] border border-line" data-lenis-prevent>
                <table className="data-table text-[12.5px]">
                    <thead>
                        <tr>
                            <th>{t('journal.decision')}</th>
                            <th>{t('journal.execution')}</th>
                            <th>{t('journal.sentence')}</th>
                            <th className="is-num">{t('journal.quantity')}</th>
                            <th className="is-num">{t('journal.price')}</th>
                            <th className="is-num">{t('journal.fee')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {initial.length > 0 && (
                            <Fragment>
                                <tr>
                                    <td colSpan={6} className="!h-9 !bg-canvas">
                                        <button type="button" onClick={() => setShowInitial((v) => !v)} aria-expanded={showInitial}
                                            className="flex items-center gap-1.5 text-[12.5px] font-bold text-muted-foreground hover:text-foreground">
                                            {showInitial ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                                            {t('journal.initial', { count: initial.length, date: f.date(initial[0].executionDay) })}
                                        </button>
                                    </td>
                                </tr>
                                {showInitial && initial.map(row)}
                            </Fragment>
                        )}
                        {ruled.map(row)}
                        {ruled.length === 0 && (
                            <tr><td colSpan={6} className="!h-auto py-6 text-center !whitespace-normal text-faint">{rules.length === 0 ? t('journal.noRules') : t('journal.empty')}</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
