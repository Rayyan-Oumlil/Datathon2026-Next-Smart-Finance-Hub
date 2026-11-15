import { useTranslations } from 'next-intl';
import type { Level } from '@/lib/domain/types';
import { useFmt } from '../useFmt';
import { leadRow, riskRows, type AvailableWindow } from './logic';
import { GrowBar, Section } from './parts';

// Each holding's share of the value next to its share of the risk. Two bars per holding, both with their numbers:
// the gap between them is the finding.
export default function ValueVsRisk({ window, level }: { window: AvailableWindow; level: Level }) {
    const t = useTranslations('Xray');
    const fmt = useFmt();
    const { rows, hidden } = riskRows(window, level);
    const lead = leadRow(window);
    const novice = level === 'Novice';
    const splittable = window.risk.some((row) => row.riskSharePct !== null);

    return (
        <Section title={t('valueRisk.title')} sub={t('valueRisk.sub')} tag="scenario">
            {!splittable ? (
                <p className="text-[13px] text-muted-foreground">{t('valueRisk.notAvailable')}</p>
            ) : (
                <>
                    {lead && lead.riskSharePct !== null && (
                        <p className="mb-3 rounded-[10px] bg-brand-soft px-3 py-2 text-[13.5px] text-foreground">
                            {t(novice ? 'valueRisk.leadNovice' : 'valueRisk.lead', { symbol: lead.symbol, value: fmt.share(lead.weightPct), risk: fmt.share(lead.riskSharePct) })}
                        </p>
                    )}
                    <ul className="flex flex-col gap-3.5">
                        {rows.map((row) => (
                            <li key={row.symbol} className="grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)] items-center gap-x-3 text-[12.5px]">
                                <span className="truncate font-semibold text-foreground">{row.symbol}</span>
                                <div className="flex flex-col gap-1">
                                    <Bar label={t('valueRisk.value')} value={row.weightPct} tone="bg-line-strong" format={fmt.share} />
                                    <Bar label={t('valueRisk.risk')} value={row.riskSharePct} tone="bg-brand" format={fmt.share} />
                                </div>
                            </li>
                        ))}
                    </ul>
                    {hidden > 0 && <p className="mt-3 text-[12px] text-faint">{t('valueRisk.more', { count: hidden })}</p>}
                </>
            )}
        </Section>
    );
}

function Bar({ label, value, tone, format }: { label: string; value: number | null; tone: string; format: (value: number) => string }) {
    return (
        <div className="flex items-center gap-2">
            <span className="w-11 flex-none text-[11px] text-faint">{label}</span>
            <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-hover" aria-hidden>
                <GrowBar value={value ?? 0} className={tone} />
            </div>
            <span className="num w-12 flex-none text-end font-bold text-foreground">{value === null ? '–' : format(value)}</span>
        </div>
    );
}
