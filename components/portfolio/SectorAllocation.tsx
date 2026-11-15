import { useTranslations } from 'next-intl';
import type { Level } from '@/lib/domain/types';
import Panel from '@/components/Panel';
import { useFmt } from './useFmt';

type Props = { bySector: Record<string, number>; cashCad: number; totalCad: number; unpriced: string[]; level: Level };

// Share of the simulated portfolio per sector, cash included so the bars add up to the total value.
export default function SectorAllocation({ bySector, cashCad, totalCad, unpriced, level }: Props) {
    const t = useTranslations('Portfolio');
    const fmt = useFmt();
    const rows = [
        ...Object.entries(bySector).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value, cash: false })),
        { name: t('cash'), value: cashCad, cash: true },
    ];
    return (
        <Panel title={t('sector.title')} sub={t('sector.sub')} bodyClassName="p-4">
            <ul className="flex flex-col gap-3">
                {rows.map(({ name, value, cash }) => {
                    const share = totalCad > 0 ? (value / totalCad) * 100 : 0;
                    return (
                        <li key={name}>
                            <div className="flex items-baseline justify-between gap-3 text-[13.5px]">
                                <span className="min-w-0 truncate font-semibold text-foreground">{name}</span>
                                <span className="num flex-none text-muted-foreground">
                                    <span className="font-bold text-foreground">{fmt.share(share)}</span>
                                    {level !== 'Novice' && <> · {fmt.cad(value)}</>}
                                </span>
                            </div>
                            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-hover" aria-hidden>
                                <div className={`h-full rounded-full ${cash ? 'bg-line-strong' : 'bg-brand'}`} style={{ width: `${Math.min(100, Math.max(0, share))}%` }} />
                            </div>
                        </li>
                    );
                })}
            </ul>
            <p className="mt-4 text-[12px] leading-relaxed text-faint">
                {t('sector.note')}
                {unpriced.length > 0 && ` ${t('sector.unpriced', { list: unpriced.join(', ') })}`}
            </p>
        </Panel>
    );
}
