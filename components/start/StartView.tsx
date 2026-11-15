'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { formatMoney } from '@/i18n/format';
import type { ModelPortfoliosView } from '@/lib/services/model-portfolio';
import OptionCard from './OptionCard';

type Props = { data: ModelPortfoliosView };

/** The suggested-portfolios step: amount, the three option cards, and the way on to the strategy. */
export default function StartView({ data }: Props) {
    const t = useTranslations('Start');
    const locale = useLocale();
    const router = useRouter();
    const [amountText, setAmountText] = useState(String(data.defaultAmountCad));
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    /** Set when some lines were skipped: the notice stays on screen until the visitor continues. */
    const [nextHref, setNextHref] = useState<string | null>(null);

    const money = (value: number) => formatMoney(value, 'CAD', locale, { maximumFractionDigits: 0 });
    const amount = Number(amountText.replace(/\s/g, '').replace(',', '.'));
    const amountValid = Number.isFinite(amount) && amount >= data.minAmountCad && amount <= data.maxAmountCad;
    const shownAmount = amountValid ? amount : data.defaultAmountCad;

    async function apply(optionId: string) {
        if (!amountValid || busy) return;
        setBusy(optionId);
        setError(null);
        setNotice(null);
        setNextHref(null);
        try {
            const res = await fetch('/api/model-portfolios/apply', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ optionId, amountCad: amount, ...(data.hasPortfolio ? { replace: true } : {}) }),
            });
            const body = await res.json().catch(() => null);
            if (!res.ok || !body?.ok) {
                setError(res.status === 409 ? t('error.exists') : t('error.generic'));
                setBusy(null);
                return;
            }
            if (Array.isArray(body.skipped) && body.skipped.length > 0) {
                setNotice(t('skippedLines', { count: body.skipped.length, symbols: body.skipped.map((s: { symbol: string }) => s.symbol).join(', ') }));
                setNextHref(body.next ?? '/strategy');
                setBusy(null);
                router.refresh();
                return;
            }
            router.push(body.next ?? '/strategy');
            router.refresh();
        } catch {
            setError(t('error.generic'));
            setBusy(null);
        }
    }

    return (
        <>
            <header className="page-head">
                <div className="min-w-0">
                    <p className="kicker">{t('kicker')}</p>
                    <h1 className="page-title mt-1">
                        {t('title')} <span className="pill is-brand ms-1 align-middle">{t('simulated')}</span>
                    </h1>
                    <p className="page-sub max-w-[720px]">{t('intro', { risk: data.risk })}</p>
                </div>
                <div className="flex flex-col items-end gap-2">
                    <span className="pill">{t('label')}</span>
                    <span className="mono text-[11.5px] text-faint">{t('tableVersion', { version: data.version })}</span>
                </div>
            </header>

            {data.hasPortfolio && (
                <div className="hatch">
                    <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
                        <div className="min-w-0">
                            <p className="text-[14.5px] font-bold text-foreground">{t('existing.title')}</p>
                            <p className="mt-0.5 text-[13px] text-muted-foreground">{t('existing.body', { count: data.positions })}</p>
                        </div>
                        <Link href="/strategy" className="btn btn-primary">
                            {t('existing.continue')} <ArrowRight aria-hidden />
                        </Link>
                    </div>
                </div>
            )}

            <div className="hatch">
                <div className="card flex flex-wrap items-end justify-between gap-4 p-4">
                    <label className="flex flex-col gap-1.5">
                        <span className="form-label">{t('amount.label')}</span>
                        <span className="flex items-center gap-2">
                            <input
                                type="number"
                                inputMode="numeric"
                                min={data.minAmountCad}
                                max={data.maxAmountCad}
                                step={100}
                                value={amountText}
                                onChange={(e) => setAmountText(e.target.value)}
                                aria-invalid={!amountValid}
                                className="num h-10 w-40 rounded-[10px] border border-line bg-card px-3 text-[15px] font-semibold text-foreground outline-none focus:border-brand"
                            />
                            <span className="text-[14px] font-semibold text-muted-foreground">{t('amount.currency')}</span>
                        </span>
                        <span className={`text-[12px] ${amountValid ? 'text-faint' : 'text-down'}`}>
                            {amountValid
                                ? t('amount.help', { min: money(data.minAmountCad), max: money(data.maxAmountCad) })
                                : t('amount.invalid', { min: money(data.minAmountCad), max: money(data.maxAmountCad) })}
                        </span>
                    </label>
                    <Link href="/portfolio" className="text-[13px] font-semibold text-faint underline underline-offset-4 hover:text-foreground">
                        {t('skip')}
                    </Link>
                </div>
            </div>

            {(error || notice) && (
                <div role="status" className="flex flex-wrap items-center justify-between gap-3 px-1">
                    <p className={`text-[13px] font-semibold ${error ? 'text-down' : 'text-muted-foreground'}`}>{error ?? notice}</p>
                    {!error && nextHref && (
                        <Link href={nextHref} className="btn btn-primary">
                            {t('skippedContinue')} <ArrowRight aria-hidden />
                        </Link>
                    )}
                </div>
            )}

            <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
                {data.options.map((option) => (
                    <OptionCard
                        key={option.id}
                        option={option}
                        amountCad={shownAmount}
                        replaceMode={data.hasPortfolio}
                        disabled={!amountValid || (busy !== null && busy !== option.id)}
                        busy={busy === option.id}
                        onApply={() => apply(option.id)}
                    />
                ))}
            </div>

            <p className="px-1 text-center text-[12px] text-faint">{t('label')} · {t('figures.note')}</p>
        </>
    );
}
