'use client';

import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { RuleSentence } from '@/components/strategy';
import type { ReplayOrder, ReplayResult } from '@/lib/replay/engine/types';
import { conditionText, ruleById, ruleColor, ruleDescription, ruleIndex, ruleName } from './rules';
import { useReplayFmt } from './useReplayFmt';

type Props = {
    result: ReplayResult;
    eventIndex: number;
    ordersById: Map<string, ReplayOrder>;
    onSelect: (eventIndex: number | null) => void;
};

// One rule firing: its sentence, the rule and its condition with the actual numbers, the value just before and just
// after, and the orders it placed (or could not place, with the reason).
export default function EventDetail({ result, eventIndex, ordersById, onSelect }: Props) {
    const t = useTranslations('Replay');
    const f = useReplayFmt();
    const event = result.ruleEvents[eventIndex];
    if (!event) return null;
    const rule = ruleById(result, event.ruleId);
    const color = ruleColor(ruleIndex(result).get(event.ruleId) ?? 0);
    const orders = event.orderIds.map((id) => ordersById.get(id)).filter((o): o is ReplayOrder => !!o);
    const delta = event.valueAfterExecutionCad - event.valueAtDecisionCad;
    const last = result.ruleEvents.length - 1;

    return (
        <section className="rounded-[14px] border border-line bg-card p-4" aria-live="polite" aria-label={t('event.title')}>
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                    <p className="kicker">{t('event.title')}</p>
                    <h3 className="mt-1 flex items-center gap-2 text-[15px] font-bold text-foreground">
                        <span className="inline-block size-2.5 flex-none rotate-45 rounded-[2px]" style={{ background: color }} />
                        {ruleName(t, result, event.ruleId)}
                        {event.guard && <span className="pill">{t(`event.guard.${event.guard}`)}</span>}
                    </h3>
                    {rule && <p className="mt-0.5 text-[12.5px] text-faint">{ruleDescription(t, f, rule)}</p>}
                </div>
                <div className="flex flex-none items-center gap-1">
                    <button type="button" className="icon-btn" disabled={eventIndex <= 0} onClick={() => onSelect(eventIndex - 1)} aria-label={t('event.previous')}><ChevronLeft /></button>
                    <span className="num text-[12px] text-faint">{t('event.position', { n: eventIndex + 1, total: last + 1 })}</span>
                    <button type="button" className="icon-btn" disabled={eventIndex >= last} onClick={() => onSelect(eventIndex + 1)} aria-label={t('event.next')}><ChevronRight /></button>
                    <button type="button" className="icon-btn" onClick={() => onSelect(null)} aria-label={t('event.close')}><X /></button>
                </div>
            </div>

            {rule && <div className="mt-3 rounded-[10px] bg-canvas px-3 py-2 text-[13px] leading-relaxed text-muted-foreground"><RuleSentence rule={rule} /></div>}
            <p className="mt-3 text-[14px] leading-relaxed text-foreground">{event.sentence[f.locale]}</p>

            <dl className="mt-3 grid gap-2 text-[12.5px] sm:grid-cols-2">
                <div className="rounded-[10px] bg-canvas px-3 py-2">
                    <dt className="text-faint">{t('event.condition')}</dt>
                    <dd className="mt-0.5 text-foreground">{conditionText(t, f, event)}</dd>
                </div>
                <div className="rounded-[10px] bg-canvas px-3 py-2">
                    <dt className="text-faint">{t('event.days')}</dt>
                    <dd className="num mt-0.5 text-foreground">{t('event.daysValue', { decision: f.date(event.decisionDay), execution: f.date(event.executionDay) })}</dd>
                </div>
                <div className="rounded-[10px] bg-canvas px-3 py-2">
                    <dt className="text-faint">{t('event.before')}</dt>
                    <dd className="num mt-0.5 font-bold text-foreground">{f.money(event.valueAtDecisionCad, 2)}</dd>
                </div>
                <div className="rounded-[10px] bg-canvas px-3 py-2">
                    <dt className="text-faint">{t('event.after')}</dt>
                    <dd className="num mt-0.5 font-bold text-foreground">{f.money(event.valueAfterExecutionCad, 2)} <span className="font-normal text-faint">({f.signedMoney(delta, 2)})</span></dd>
                </div>
            </dl>
            <p className="mt-1.5 text-[11.5px] text-faint">{t('event.beforeAfterNote')}</p>

            {(orders.length > 0 || event.notPlaced.length > 0) && (
                <div className="mt-3">
                    <p className="text-[12px] font-bold text-muted-foreground">{t('event.orders', { count: orders.length })}</p>
                    <ul className="row-list mt-1 max-h-56 overflow-auto pe-1 text-[12.5px]" data-lenis-prevent>
                        {orders.map((o) => (
                            <li key={o.id} className="py-1.5 text-foreground">{o.sentence[f.locale]}</li>
                        ))}
                        {event.notPlaced.map((np, k) => (
                            <li key={`np-${k}`} className="py-1.5 text-faint">{np.sentence[f.locale]}</li>
                        ))}
                    </ul>
                </div>
            )}
        </section>
    );
}
