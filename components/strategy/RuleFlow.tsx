'use client';

import type { ReactNode } from 'react';
import { ArrowRight, CheckCheck, Clock3, Play, Trash2, Zap } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { formatMoney } from '@/i18n/format';
import { STRATEGY_CONFIG } from '@/lib/strategy/config';
import type { StrategyRule } from '@/lib/strategy/types';
import { byPriority } from './model';
import { KIND_ICON, useRuleTags, type RuleEditing } from './RuleCard';

export type RuleFlowProps = {
    rules: StrategyRule[];
    /** Editing for one rule (the builder); absent: read-only, values are plain emphasised text. */
    editFor?: (rule: StrategyRule) => RuleEditing | undefined;
    /** Problems the server found in one rule, already in the page's language. */
    issuesFor?: (rule: StrategyRule) => string[];
    /** Firings per rule id (from a replay's ruleStats). */
    firings?: Record<string, number>;
    className?: string;
};

type Step = 'when' | 'check' | 'action';
const STEP_ICON: Record<Step, typeof Zap> = { when: Zap, check: Clock3, action: Play };

function Arrow() {
    // Points right in a row, down when the nodes stack (narrow container)
    return (
        <span aria-hidden className="flex flex-none items-center justify-center self-center text-line-strong">
            <ArrowRight className="size-4 rotate-90 @2xl:rotate-0" />
        </span>
    );
}

function Node({ step, children, tone = 'plain' }: { step: Step; children: ReactNode; tone?: 'plain' | 'muted' | 'accent' }) {
    const t = useTranslations('Strategy');
    const Icon = STEP_ICON[step];
    const frame = tone === 'muted' ? 'bg-hover border-transparent' : tone === 'accent' ? 'bg-card border-brand/40' : 'bg-card border-line';
    return (
        <div className={`grid min-w-0 flex-1 content-start gap-1 rounded-[10px] border px-3 py-2 @2xl:basis-0 ${frame}`}>
            <span className={`inline-flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-[0.08em] ${step === 'check' ? 'text-faint' : 'text-brand-ink'}`}>
                <Icon className="size-3" aria-hidden />{t(`flow.step.${step}`)}
            </span>
            <div className="text-[13.5px] leading-7 text-muted-foreground">{children}</div>
        </div>
    );
}

function FlowRow({ rule, position, edit, issues, fired }: { rule: StrategyRule; position: number; edit?: RuleEditing; issues?: string[]; fired?: number }) {
    const t = useTranslations('Strategy');
    const locale = useLocale();
    const { key, tags } = useRuleTags(rule, edit, issues);
    const Icon = KIND_ICON[rule.kind];
    const rich = (message: string) => t.rich(message, tags as Parameters<typeof t.rich>[1]);
    const min = formatMoney(STRATEGY_CONFIG.minOrderCad, 'CAD', locale, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    const actionKey = key.replace(/_(drift|quarterly|month|days)$/, '');

    return (
        <li className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3">
            {/* The rail: the engine's order, joined by a line */}
            <div className="relative flex flex-col items-center">
                <span className="z-[1] grid size-7 flex-none place-items-center rounded-full bg-brand-soft text-[12.5px] font-bold text-brand-ink num">{position}</span>
                <span aria-hidden className="absolute top-7 -bottom-0 w-px bg-line" />
            </div>
            <div className={`grid min-w-0 gap-2 pb-4 ${issues?.length ? 'rounded-[10px] ring-1 ring-down/50 p-2' : ''}`}>
                <header className="flex min-h-7 flex-wrap items-center gap-2">
                    <span className="bento-ico !size-6"><Icon /></span>
                    <span className="kicker">{t(`kinds.${rule.kind}.short`)}</span>
                    {fired !== undefined && <span className="pill">{t('preview.fired', { count: fired })}</span>}
                    {edit && (
                        <button type="button" className="icon-btn ms-auto size-7" aria-label={t('editor.remove')} title={t('editor.remove')} onClick={edit.onRemove}><Trash2 className="size-3.5" /></button>
                    )}
                </header>
                <div className="flex flex-col gap-1.5 @2xl:flex-row @2xl:items-stretch">
                    <Node step="when">{rich(`flow.when.${key}`)}</Node>
                    <Arrow />
                    <Node step="check" tone="muted">
                        {rule.kind === 'price_threshold'
                            ? t('flow.checkPrice', { days: STRATEGY_CONFIG.priceThresholdMinDays, min })
                            : t('flow.check', { days: STRATEGY_CONFIG.antiOscillationTradingDays, min })}
                    </Node>
                    <Arrow />
                    <Node step="action" tone="accent">{rich(`flow.action.${actionKey}`)}</Node>
                </div>
                {issues && issues.length > 0 && (
                    <ul role="alert" className="grid gap-0.5 text-[12.5px] text-down">
                        {issues.map((message) => <li key={message}>{message}</li>)}
                    </ul>
                )}
            </div>
        </li>
    );
}

/**
 * A strategy as a flow: each rule is [When] -> [Check] -> [Action], rules stacked in the engine's priority order with
 * a numbered rail, and a final step for the orders. Pure HTML and CSS; stacks vertically in a narrow container.
 * Read-only unless `editFor` is given. No fetching.
 */
export function RuleFlow({ rules, editFor, issuesFor, firings, className = '' }: RuleFlowProps) {
    const t = useTranslations('Strategy');
    const sorted = byPriority(rules);
    if (sorted.length === 0) return null;
    return (
        <div className={`@container ${className}`}>
            <ol className="grid" aria-label={t('flow.label')}>
                {sorted.map((rule, i) => (
                    <FlowRow key={rule.id} rule={rule} position={i + 1} edit={editFor?.(rule)} issues={issuesFor?.(rule)} fired={firings?.[rule.id]} />
                ))}
                <li className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3">
                    <div className="flex justify-center">
                        <span className="grid size-7 place-items-center rounded-full bg-hover text-muted-foreground"><CheckCheck className="size-3.5" aria-hidden /></span>
                    </div>
                    <p className="flex min-h-7 items-center rounded-[10px] border border-dashed border-line-strong px-3 py-1.5 text-[13px] font-semibold text-muted-foreground">{t('flow.orders')}</p>
                </li>
            </ol>
        </div>
    );
}

export default RuleFlow;
