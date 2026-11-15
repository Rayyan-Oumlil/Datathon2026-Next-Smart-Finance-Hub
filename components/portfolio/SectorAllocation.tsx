import type { Level } from '@/lib/domain/types';
import Panel from '@/components/Panel';
import { money } from './logic';

type Props = { bySector: Record<string, number>; cashCad: number; totalCad: number; unpriced: string[]; level: Level };

// Share of the simulated portfolio per sector, cash included so the bars add up to the total value.
export default function SectorAllocation({ bySector, cashCad, totalCad, unpriced, level }: Props) {
    const rows = [
        ...Object.entries(bySector).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value, cash: false })),
        { name: 'Cash', value: cashCad, cash: true },
    ];
    return (
        <Panel title="Sector allocation (simulated)" sub="Share of the simulated portfolio's value in each sector" bodyClassName="p-4">
            <ul className="flex flex-col gap-3">
                {rows.map(({ name, value, cash }) => {
                    const share = totalCad > 0 ? (value / totalCad) * 100 : 0;
                    return (
                        <li key={name}>
                            <div className="flex items-baseline justify-between gap-3 text-[13.5px]">
                                <span className="min-w-0 truncate font-semibold text-foreground">{name}</span>
                                <span className="num flex-none text-muted-foreground">
                                    <span className="font-bold text-foreground">{share.toFixed(1)}%</span>
                                    {level !== 'Novice' && <> · {money(value)} CAD</>}
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
                Sector tags come from the app&apos;s asset list (GICS sector names); an ETF or a crypto asset is grouped under its asset class.
                Values are the holdings&apos; values at the last price, as listed under Holdings.
                {unpriced.length > 0 && ` Not included, no price available right now: ${unpriced.join(', ')}.`}
            </p>
        </Panel>
    );
}
