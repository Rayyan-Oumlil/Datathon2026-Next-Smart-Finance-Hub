'use client';

import { useLocale, useTranslations } from 'next-intl';
import { formatMoney } from '@/i18n/format';
import { STRATEGY_CONFIG } from '@/lib/strategy/config';
import type { StrategyRule } from '@/lib/strategy/types';
import { byPriority, PRIORITY } from './model';
import { RuleCard } from './RuleCard';

/** The engine's order, the anti-oscillation delay and the minimum order, read from STRATEGY_CONFIG. */
export function OrderNote({ className = '' }: { className?: string }) {
    const t = useTranslations('Strategy');
    const locale = useLocale();
    return (
        <p className={`text-[12.5px] leading-5 text-faint ${className}`}>
            <span className="font-bold text-muted-foreground">{t('editor.orderTitle')} · </span>
            {t('editor.orderNote', {
                order: PRIORITY.map((kind) => t(`kinds.${kind}.name`)).join(' → '),
                days: STRATEGY_CONFIG.antiOscillationTradingDays,
                min: formatMoney(STRATEGY_CONFIG.minOrderCad, 'CAD', locale, { minimumFractionDigits: 0, maximumFractionDigits: 0 }),
            })}
        </p>
    );
}

export type StrategySummaryProps = {
    strategy: { name: string; rules: StrategyRule[] };
    /** Firings per rule id (from a replay's ruleStats), shown on each card. */
    firings?: Record<string, number>;
    /** Show the note on the order of application. Default true. */
    showOrder?: boolean;
    /** Hide the name (when the caller already shows it). */
    hideName?: boolean;
    className?: string;
};

/** A strategy, read-only: its name, its rules as sentences in the engine's priority order, and the order note. No fetching. */
export function StrategySummary({ strategy, firings, showOrder = true, hideName, className = '' }: StrategySummaryProps) {
    const t = useTranslations('Strategy');
    const rules = byPriority(strategy.rules);
    return (
        <section className={`grid gap-2 ${className}`}>
            {!hideName && (
                <header className="flex flex-wrap items-baseline gap-2">
                    <h3 className="text-[15px] font-bold text-foreground">{strategy.name}</h3>
                    <span className="text-[12.5px] text-faint">{t('list.rules', { count: rules.length })}</span>
                </header>
            )}
            {rules.map((rule, i) => <RuleCard key={rule.id} rule={rule} position={i + 1} fired={firings?.[rule.id]} />)}
            {showOrder && rules.length > 1 && <OrderNote />}
        </section>
    );
}

export default StrategySummary;
