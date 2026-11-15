import { useTranslations } from 'next-intl';
import type { XrayView } from '@/lib/services/portfolio-xray';
import { useFmt } from '../useFmt';
import { segmentsOf } from './logic';
import { Section } from './parts';

const TONES = ['bg-brand', 'bg-brand/60', 'bg-brand/35', 'bg-line-strong'];

type Row = { name: string; sharePct: number };

// Where the money sits today: by sector, kind of asset and currency. One segmented bar each, with the numbers
// written out beside it so the colours carry no meaning of their own.
export default function Exposure({ view }: { view: XrayView }) {
    const t = useTranslations('Xray');
    const fmt = useFmt();
    const cash = { name: t('exposure.cash'), sharePct: view.cashSharePct };
    const kind = (name: string) => (['stock', 'etf', 'crypto'].includes(name) ? t(`exposure.${name}`) : name);
    const { concentration: c } = view;
    const lines: Array<{ label: string; rows: Row[] }> = [
        { label: t('exposure.sector'), rows: c.groups },
        { label: t('exposure.assetClass'), rows: c.assetClasses.map((row) => ({ ...row, name: kind(row.name) })) },
        // Cash is held in Canadian dollars, so the currency line already counts it
        { label: t('exposure.currency'), rows: c.currencies },
    ];

    return (
        <Section title={t('exposure.title')} tag="fact">
            <div className="flex flex-col gap-4">
                {lines.map(({ label, rows }, index) => {
                    const all = index === 2 ? rows : [...rows, cash].filter((row) => row.sharePct > 0).sort((a, b) => b.sharePct - a.sharePct);
                    const segments = segmentsOf(all);
                    return (
                        <div key={label}>
                            <p className="kicker">{label}</p>
                            <div className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-hover" aria-hidden>
                                {segments.map((segment, i) => (
                                    <div key={`${segment.name}-${i}`} className={segment.name === cash.name ? 'bg-line' : TONES[Math.min(i, TONES.length - 1)]} style={{ width: `${segment.sharePct}%` }} />
                                ))}
                            </div>
                            <p className="num mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
                                {segments.map((segment, i) => (
                                    <span key={`${segment.name}-${i}`}>
                                        {i > 0 && ' · '}
                                        <span className="font-semibold text-foreground">{segment.name || `+${segment.rest}`}</span> {fmt.share(segment.sharePct)}
                                    </span>
                                ))}
                            </p>
                        </div>
                    );
                })}
            </div>
        </Section>
    );
}
