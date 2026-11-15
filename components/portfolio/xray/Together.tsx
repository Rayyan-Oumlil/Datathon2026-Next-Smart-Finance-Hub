import { formatNumber } from '@/i18n/format';
import { useTranslations } from 'next-intl';
import { useFmt } from '../useFmt';
import type { AvailableWindow } from './logic';
import { Section } from './parts';

// Which holdings moved alike in the period, and how much the mix as a whole offset its parts.
export default function Together({ window }: { window: AvailableWindow }) {
    const t = useTranslations('Xray');
    const { locale } = useFmt();
    const two = (value: number) => formatNumber(value, locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    return (
        <Section title={t('together.title')} sub={t('together.sub')} tag="scenario">
            {window.pairs.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">{t('together.none')}</p>
            ) : (
                <ul className="row-list">
                    {window.pairs.map((pair) => (
                        <li key={`${pair.a}-${pair.b}`} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                            <span className="min-w-0 truncate font-semibold text-foreground">{pair.a} · {pair.b}</span>
                            <span className="num flex-none font-bold text-foreground">{two(pair.correlation)}</span>
                        </li>
                    ))}
                </ul>
            )}
            {window.diversificationRatio !== null && (
                <p className="mt-3 text-[12.5px] leading-relaxed text-muted-foreground">
                    <span className="font-semibold text-foreground">{t('together.ratio')} <span className="num">{two(window.diversificationRatio)}</span>.</span>{' '}
                    {t('together.ratioNote')}
                </p>
            )}
        </Section>
    );
}
