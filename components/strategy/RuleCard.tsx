'use client';

import type { ReactNode } from 'react';
import { CalendarClock, Crosshair, Scale, ShieldAlert, Trash2, Layers } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { formatMoney, formatNumber, formatPercent } from '@/i18n/format';
import { LIMITS, TRIGGER_TYPES, type AllocationTarget, type PriceThresholdRule, type RuleKind, type WeightCapRule, type StrategyRule, type TriggerType } from '@/lib/strategy/types';
import { Chip, ChoiceEditor, FreeNumberEditor, NumberEditor, SymbolEditor, TargetsEditor } from './Chip';

/** What an editable card needs from the builder. Without it, the card is read-only. */
export type RuleEditing = {
    onChange: (rule: StrategyRule) => void;
    onRemove: () => void;
    /** Symbols held in the simulated portfolio, offered first in symbol pickers. */
    holdings: string[];
    /** The portfolio's current weights, offered as targets ("use the current weights"). */
    currentTargets: AllocationTarget[];
};

export type RuleCardProps = {
    rule: StrategyRule;
    /** 1-based position shown as "Rule n"; omitted: no position. */
    position?: number;
    /** How many times the rule fired in a replay, shown as a pill. */
    fired?: number;
    /** Problems the server found in this rule, already in the page's language. */
    issues?: string[];
    /** Present: chips open editors. Absent: read-only (agent panel, time machine). */
    edit?: RuleEditing;
    /** Sentence only, no card frame. */
    bare?: boolean;
    className?: string;
};

export const KIND_ICON: Record<RuleKind, typeof Scale> = {
    allocation_target: Scale,
    weight_cap: Layers,
    drawdown_guard: ShieldAlert,
    periodic_purchase: CalendarClock,
    price_threshold: Crosshair,
};

type Tags = Record<string, (chunks: ReactNode) => ReactNode>;

/** The values of a rule's message: chips (rich-text tags) and formatted values. */
export type RuleTags = Record<string, ReactNode | ((chunks: ReactNode) => ReactNode)>;

/**
 * The parts of a rule's sentence: the message key (Strategy.sentence.<key>) and its tags. The sentence and the flow
 * view (RuleFlow) use the same tags, so a value is the same clickable chip in both.
 */
export function useRuleTags(rule: StrategyRule, edit?: RuleEditing, issues?: string[]): { key: string; tags: RuleTags } {
    const t = useTranslations('Strategy');
    const locale = useLocale();
    const pct = (value: number) => formatPercent(value, locale, { maximumFractionDigits: 1 });
    const money = (value: number) => formatMoney(value, 'CAD', locale, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    const num = (value: number) => formatNumber(value, locale, { maximumFractionDigits: 2 });
    const invalid = (issues?.length ?? 0) > 0;
    const change = (next: StrategyRule) => edit?.onChange(next);

    /** A chip whose editor is only built when the card is editable. */
    const chip = (label: string, editor: (close: () => void) => ReactNode) => function ChipTag(chunks: ReactNode) {
        return <Chip label={label} invalid={invalid} editor={edit ? editor : undefined}>{chunks}</Chip>;
    };
    const numberChip = (label: string, value: number, range: { min: number; max: number }, apply: (value: number) => StrategyRule, integer?: boolean) =>
        chip(label, (close) => <NumberEditor value={value} min={range.min} max={range.max} integer={integer} onApply={(v) => { change(apply(v)); close(); }} />);
    const symbolChip = (label: string, value: string, apply: (symbol: string) => StrategyRule) =>
        chip(label, (close) => <SymbolEditor value={value} holdings={edit?.holdings ?? []} onApply={(s) => { change(apply(s)); close(); }} />);

    const targetsText = (targets: AllocationTarget[]) => {
        if (targets.length === 0) return t('values.targetsEmpty');
        const sorted = [...targets].sort((a, b) => b.weightPct - a.weightPct);
        const one = (target: AllocationTarget) => ('symbol' in target ? `${target.symbol} ${pct(target.weightPct)}` : `${t('values.group', { group: target.group, symbols: target.symbols.join(', ') })} ${pct(target.weightPct)}`);
        const shown = sorted.slice(0, 3).map(one).join(', ');
        return sorted.length > 3 ? t('values.targetsMore', { list: shown, more: sorted.length - 3 }) : t('values.targetsSummary', { list: shown });
    };

    let key = '';
    let tags: RuleTags = {};
    const record = (sentence: string, values: RuleTags) => { key = sentence.replace(/^sentence\./, ''); tags = values; return null; };
    let content: ReactNode;
    switch (rule.kind) {
        case 'allocation_target': {
            const drift = rule.rebalance.mode === 'drift' ? rule.rebalance.driftPts : null;
            const common: Tags = {
                mode: chip(t('chip.mode'), (close) => (
                    <ChoiceEditor
                        value={rule.rebalance.mode}
                        options={[['drift', t('chip.modeDrift')], ['quarterly', t('chip.modeQuarterly')]] as const}
                        onApply={(mode) => { change({ ...rule, rebalance: mode === 'drift' ? { mode, driftPts: drift ?? 5 } : { mode } }); close(); }}
                    />
                )),
                targets: chip(t('chip.targets'), (close) => (
                    <TargetsEditor value={rule.targets} current={edit?.currentTargets ?? []} holdings={edit?.holdings ?? []} onApply={(targets) => { change({ ...rule, targets }); close(); }} />
                )),
            };
            content = drift === null
                ? record('sentence.allocation_target_quarterly', { ...common, targetsV: targetsText(rule.targets) })
                : record('sentence.allocation_target_drift', {
                    ...common,
                    drift: numberChip(t('chip.drift'), drift, LIMITS.driftPts, (driftPts) => ({ ...rule, rebalance: { mode: 'drift', driftPts } })),
                    driftV: t('values.points', { value: num(drift) }),
                    targetsV: targetsText(rule.targets),
                });
            break;
        }
        case 'weight_cap': {
            content = record('sentence.weight_cap', {
                cap: numberChip(t('chip.cap'), rule.maxWeightPct, LIMITS.capPct, (maxWeightPct) => ({ ...rule, maxWeightPct })),
                capV: pct(rule.maxWeightPct),
                dest: chip(t('chip.dest'), (close) => <DestinationEditor value={rule.proceedsSymbol} holdings={edit?.holdings ?? []} onApply={(proceedsSymbol) => {
                    const next: WeightCapRule = { ...rule, proceedsSymbol };
                    if (!proceedsSymbol) delete next.proceedsSymbol;
                    change(next);
                    close();
                }} />),
                destV: rule.proceedsSymbol ? t('values.inSymbol', { symbol: rule.proceedsSymbol }) : t('values.cash'),
            });
            break;
        }
        case 'drawdown_guard':
            content = record('sentence.drawdown_guard', {
                trigger: numberChip(t('chip.trigger'), rule.triggerDrawdownPct, LIMITS.triggerDrawdownPct, (triggerDrawdownPct) => ({ ...rule, triggerDrawdownPct })),
                triggerV: pct(rule.triggerDrawdownPct),
                move: numberChip(t('chip.move'), rule.movePct, LIMITS.movePct, (movePct) => ({ ...rule, movePct })),
                moveV: pct(rule.movePct),
                symbol: symbolChip(t('chip.symbol'), rule.defensiveSymbol, (defensiveSymbol) => ({ ...rule, defensiveSymbol })),
                symbolV: rule.defensiveSymbol,
                recover: numberChip(t('chip.recover'), rule.recoverDrawdownPct, LIMITS.recoverDrawdownPct, (recoverDrawdownPct) => ({ ...rule, recoverDrawdownPct })),
                recoverV: pct(rule.recoverDrawdownPct),
            });
            break;
        case 'periodic_purchase': {
            const common: Tags = {
                every: chip(t('chip.every'), (close) => (
                    <ChoiceEditor
                        value={rule.every.unit}
                        options={[['month', t('chip.everyMonth')], ['trading_days', t('chip.everyDays')]] as const}
                        onApply={(unit) => { change({ ...rule, every: unit === 'month' ? { unit } : { unit, n: rule.every.unit === 'trading_days' ? rule.every.n : 21 } }); close(); }}
                    />
                )),
                amount: numberChip(t('chip.amount'), rule.amountCad, LIMITS.purchaseCad, (amountCad) => ({ ...rule, amountCad })),
            };
            content = rule.every.unit === 'month'
                ? record('sentence.periodic_purchase_month', { ...common, amountV: money(rule.amountCad) })
                : record('sentence.periodic_purchase_days', {
                    ...common,
                    n: numberChip(t('chip.n'), rule.every.n, LIMITS.everyTradingDays, (n) => ({ ...rule, every: { unit: 'trading_days', n } }), true),
                    nV: t('values.tradingDays', { n: rule.every.n }),
                    amountV: money(rule.amountCad),
                });
            break;
        }
        case 'price_threshold': {
            const onPrice = rule.trigger.type === 'price_below' || rule.trigger.type === 'price_above';
            const plain: PriceThresholdRule = { ...rule };
            delete plain.text;
            content = record('sentence.price_threshold', {
                symbol: symbolChip(t('chip.symbol'), rule.symbol, (symbol) => ({ ...plain, symbol })),
                symbolV: rule.symbol,
                trigger: chip(t('chip.triggerType'), (close) => (
                    <ChoiceEditor<TriggerType>
                        value={rule.trigger.type}
                        options={TRIGGER_TYPES.map((type) => [type, t(`values.trigger.${type}`)] as const)}
                        onApply={(type) => {
                            const toPrice = type.startsWith('price');
                            // Switching between a price and a % change keeps a value that makes sense for the new kind
                            const value = toPrice === onPrice ? rule.trigger.value : toPrice ? 100 : type === 'change_pct_below' ? -3 : 3;
                            change({ ...plain, trigger: { type, value } });
                            close();
                        }}
                    />
                )),
                triggerV: t(`values.trigger.${rule.trigger.type}`),
                value: chip(onPrice ? t('chip.valuePrice') : t('chip.valueChange'), (close) => (
                    <FreeNumberEditor
                        value={rule.trigger.value}
                        check={(v) => (onPrice ? v > 0 : v !== 0 && Math.abs(v) <= 100)}
                        onApply={(value) => { change({ ...plain, trigger: { ...rule.trigger, value } }); close(); }}
                    />
                )),
                valueV: onPrice ? num(rule.trigger.value) : pct(rule.trigger.value),
                side: chip(t('chip.side'), (close) => (
                    <ChoiceEditor value={rule.action.side} options={[['buy', t('values.side.buy')], ['sell', t('values.side.sell')]] as const} onApply={(side) => { change({ ...plain, action: { ...rule.action, side } }); close(); }} />
                )),
                sideV: t(`values.side.${rule.action.side}`),
                amount: numberChip(t('chip.amount'), rule.action.amountCad ?? 500, { min: LIMITS.purchaseCad.min, max: 10_000_000 }, (amountCad) => ({ ...plain, action: { side: rule.action.side, amountCad } })),
                amountV: rule.action.amountCad !== undefined ? money(rule.action.amountCad) : t('values.units', { value: num(rule.action.quantity ?? 0) }),
                once: chip(t('chip.once'), (close) => (
                    <ChoiceEditor value={rule.once ? 'true' : 'false'} options={[['true', t('chip.onceTrue')], ['false', t('chip.onceFalse')]] as const} onApply={(v) => { change({ ...plain, once: v === 'true' }); close(); }} />
                )),
                onceV: t(`values.once.${rule.once ? 'true' : 'false'}`),
            });
            break;
        }
    }
    void content;
    return { key, tags };
}

/** The rule as one sentence with its values as chips (next-intl rich text, namespace Strategy). */
export function RuleSentence({ rule, edit, issues }: { rule: StrategyRule; edit?: RuleEditing; issues?: string[] }) {
    const t = useTranslations('Strategy');
    const { key, tags } = useRuleTags(rule, edit, issues);
    return <p className="text-[15px] leading-8 text-muted-foreground">{t.rich(`sentence.${key}`, tags as Parameters<typeof t.rich>[1])}</p>;
}

function DestinationEditor({ value, holdings, onApply }: { value?: string; holdings: string[]; onApply: (symbol: string | undefined) => void }) {
    const t = useTranslations('Strategy');
    return (
        <div className="grid gap-2">
            <button type="button" className={`btn btn-ghost h-9 justify-start px-3 text-[13px] ${value ? '' : 'is-on'}`} onClick={() => onApply(undefined)}>{t('chip.destCash')}</button>
            <span className="text-[11.5px] text-faint">{t('chip.destSymbol')}</span>
            <SymbolEditor value={value} holdings={holdings} onApply={onApply} />
        </div>
    );
}

/**
 * One rule as a card: its kind, then one sentence whose values are chips. Read-only unless `edit` is given; it never
 * fetches data by itself (in edit mode, the symbol picker searches the universe as the user types).
 */
export function RuleCard({ rule, position, fired, issues, edit, bare, className = '' }: RuleCardProps) {
    const t = useTranslations('Strategy');
    const Icon = KIND_ICON[rule.kind];
    if (bare) return <RuleSentence rule={rule} edit={edit} issues={issues} />;
    return (
        <article className={`card grid gap-1.5 p-4 ${issues?.length ? 'ring-1 ring-down/50' : ''} ${className}`}>
            <header className="flex items-center gap-2">
                <span className="bento-ico !size-7"><Icon /></span>
                <span className="kicker">{position !== undefined ? `${t('editor.ruleNumber', { n: position })} · ` : ''}{t(`kinds.${rule.kind}.name`)}</span>
                {fired !== undefined && <span className="pill">{t('preview.fired', { count: fired })}</span>}
                {edit && (
                    <button type="button" className="icon-btn ms-auto" aria-label={t('editor.remove')} title={t('editor.remove')} onClick={edit.onRemove}><Trash2 className="size-4" /></button>
                )}
            </header>
            <RuleSentence rule={rule} edit={edit} issues={issues} />
            {issues && issues.length > 0 && (
                <ul role="alert" className="grid gap-0.5 text-[12.5px] text-down">
                    {issues.map((message) => <li key={message}>{message}</li>)}
                </ul>
            )}
        </article>
    );
}

export default RuleCard;
