'use client';

import { FlaskConical } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { formatNumber } from '@/i18n/format';
import type { XrayView } from '@/lib/services/portfolio-xray';
import { observationsOf, type Observation, type Test } from '@/lib/xray/observations';
import { useFmt } from '../useFmt';
import type { AvailableWindow } from './logic';
import { Section } from './parts';

// Plain readings of the numbers on the page, chosen by fixed rules (lib/xray/observations.ts). They describe; they
// never instruct. A reading about one holding offers to open the what-if lab on it, with no amount chosen by the app.
export default function Observations({ view, window, onTest }: { view: XrayView; window: AvailableWindow; onTest: (test: Test) => void }) {
    const t = useTranslations('Xray');
    const fmt = useFmt();
    const two = (value: number) => formatNumber(value, fmt.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const list = observationsOf({
        holdings: view.holdings,
        concentration: view.concentration,
        currencies: view.concentration.currencies,
        cashSharePct: view.cashSharePct,
        band: view.band,
        window,
    });
    if (list.length === 0) return null;

    const sentence = (o: Observation): string => {
        switch (o.id) {
            case 'risk_gap': return t('obs.risk_gap', { symbol: o.symbol, value: fmt.share(o.valuePct), risk: fmt.share(o.riskPct) });
            case 'above_band': return t('obs.above_band', { vol: fmt.share(o.volatilityPct), limit: fmt.share(o.limitPct) });
            case 'near_band': return t('obs.near_band', { vol: fmt.share(o.volatilityPct), limit: fmt.share(o.limitPct) });
            case 'top_holding': return t('obs.top_holding', { symbol: o.symbol, share: fmt.share(o.sharePct) });
            case 'few_holdings': return t('obs.few_holdings', { count: Math.round(o.effective) });
            case 'close_pair': return t('obs.close_pair', { a: o.a, b: o.b, corr: two(o.correlation) });
            case 'currency': return t('obs.currency', { share: fmt.share(o.sharePct) });
            case 'cash_heavy': return t('obs.cash_heavy', { share: fmt.share(o.sharePct) });
            case 'little_cushion': return t('obs.little_cushion', { ratio: two(o.ratio) });
            case 'left_out': return t('obs.left_out', { list: o.symbols.join(', '), share: fmt.share(o.sharePct) });
        }
    };

    return (
        <Section title={t('obs.title')} sub={t('obs.sub')} tag="reading">
            <ul className="flex flex-col gap-2.5">
                {list.map((o) => (
                    <li key={o.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-[10px] bg-hover px-3 py-2.5">
                        <p className="min-w-0 flex-1 basis-64 text-[13.5px] leading-relaxed text-foreground">{sentence(o)}</p>
                        {'test' in o && (
                            <button type="button" className="btn btn-ghost h-8 flex-none px-3 text-[12.5px]" onClick={() => onTest(o.test)}>
                                <FlaskConical /> {t('obs.open', { symbol: o.test.symbol })}
                            </button>
                        )}
                    </li>
                ))}
            </ul>
        </Section>
    );
}
