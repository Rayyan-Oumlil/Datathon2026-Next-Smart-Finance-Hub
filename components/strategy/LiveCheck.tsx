'use client';

import { useState } from 'react';
import { Radar } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { api } from '@/components/portfolio/logic';
import { useFmt } from '@/components/portfolio/useFmt';
import type { LiveStrategyCheck } from '@/lib/services/rules-engine';
import { ApiIssues } from './issues';

type Props = {
    /** Saves the strategy when it has unsaved changes and answers its stored id (null when the save was refused). */
    ensureSaved: () => Promise<string | null>;
    disabled?: boolean;
    ruleLabel: (ruleId: string) => string;
    /** Rules version this check belongs to, so an old answer is dimmed after an edit. */
    stamp: string;
};

/** "Que ferait cette stratégie aujourd'hui ?": POST /api/strategy/evaluate. Nothing is executed. */
export default function LiveCheck({ ensureSaved, disabled, ruleLabel, stamp }: Props) {
    const t = useTranslations('Strategy');
    const locale = useLocale();
    const fmt = useFmt();
    const [busy, setBusy] = useState(false);
    const [check, setCheck] = useState<{ result: LiveStrategyCheck; stamp: string } | null>(null);
    const [error, setError] = useState<string | null>(null);

    const run = async () => {
        setBusy(true);
        setError(null);
        try {
            const id = await ensureSaved();
            if (!id) return;
            const { check: result } = await api<{ check: LiveStrategyCheck }>('/api/strategy/evaluate', { method: 'POST', body: { strategyId: id } });
            setCheck({ result, stamp });
        } catch (failure) {
            setError(fmt.error(failure));
        } finally {
            setBusy(false);
        }
    };

    const result = check?.result;
    const lang = locale === 'fr' ? 'fr' : 'en';
    const orders = result?.events.reduce((sum, event) => sum + event.orders.length, 0) ?? 0;
    return (
        <div className="hatch">
            <div className="card grid gap-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                        <h2 className="section-title">{t('live.title')}</h2>
                        <p className="section-sub">{t('live.sub')}</p>
                    </div>
                    <button type="button" className="btn btn-ghost h-9 px-4 text-[13px]" onClick={run} disabled={busy || disabled}>
                        <Radar />{busy ? t('live.running') : t('live.run')}
                    </button>
                </div>
                {error && <ApiIssues message={error} issues={[]} />}
                {result && (
                    <div className={`grid gap-2 ${check.stamp !== stamp ? 'opacity-60' : ''}`} aria-live="polite">
                        <p className="text-[12px] text-faint">{t('live.checkedAt', { when: fmt.when(result.checkedAt), value: fmt.cad(result.valueCad) })}</p>
                        {result.events.length === 0 ? (
                            <p className="rounded-[9px] bg-hover px-3 py-2 text-[13.5px] text-muted-foreground">{t('live.none')}</p>
                        ) : (
                            <>
                                <ul className="grid gap-1.5">
                                    {result.events.map((event) => (
                                        <li key={`${event.ruleId}-${event.decisionDay}`} className="rounded-[9px] bg-brand-soft px-3 py-2 text-[13.5px] text-foreground">
                                            <span className="kicker !text-brand-ink">{ruleLabel(event.ruleId)}</span>
                                            <p className="mt-0.5">{event.sentence[lang]}</p>
                                        </li>
                                    ))}
                                </ul>
                                <p className="text-[12.5px] font-semibold text-muted-foreground">{t('live.orders', { count: orders })} · {t('live.notExecuted')}</p>
                            </>
                        )}
                        {result.skipped.length > 0 && (
                            <ul className="grid gap-0.5 text-[12.5px] text-faint">
                                {result.skipped.map((skip) => <li key={skip.ruleId}>{t('live.skipped', { rule: ruleLabel(skip.ruleId), reason: t(`live.reason.${skip.reason}`) })}</li>)}
                            </ul>
                        )}
                        {result.unpriced.length > 0 && <p className="text-[12px] text-faint">{t('live.unpriced', { symbols: result.unpriced.join(', ') })}</p>}
                    </div>
                )}
            </div>
        </div>
    );
}
