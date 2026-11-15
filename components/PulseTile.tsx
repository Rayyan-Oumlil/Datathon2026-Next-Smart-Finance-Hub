'use client';

import Link from "next/link";
import { LineChart } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import ChangePill from "@/components/ChangePill";
import PriceFlash from "@/components/PriceFlash";
import MoneyParts from "@/components/shell/MoneyParts";
import { useLiveQuotes, type LiveQuote } from "@/hooks/useLiveQuotes";
import { formatNumber } from "@/i18n/format";

const amountOptions = (value: number): Intl.NumberFormatOptions => ({ minimumFractionDigits: 2, maximumFractionDigits: value < 1 ? 4 : 2 });

type PulseTileProps = { symbol: string; label: string; initial: LiveQuote | null };

// A pulse tile priced from our own quote cache. In realtime mode it refreshes on screen,
// so the "Live · 15s" label is true; in cached mode it shows the server-rendered quote.
export default function PulseTile({ symbol, label, initial }: PulseTileProps) {
    const t = useTranslations('PulseTile');
    const locale = useLocale();
    const live = useLiveQuotes([symbol]);
    const quote = live[symbol] ?? initial;
    const isCrypto = symbol.startsWith('BINANCE:');

    return (
        <Link href={`/stocks/${encodeURIComponent(symbol)}`} className="bento-tile transition-colors hover:bg-hover/60">
            <div className="bento-head">
                <span className="bento-ico"><LineChart /></span>
                <span className="truncate">{label}</span>
                <span className="mono ms-auto text-xs text-faint">{symbol.replace('BINANCE:', '')}</span>
            </div>
            <PriceFlash value={quote?.c} className="bento-value self-start">
                {quote?.c ? (
                    isCrypto
                        ? <>{formatNumber(quote.c, locale, amountOptions(quote.c))}<small> USDT</small></>
                        : <MoneyParts amount={quote.c} currency="USD" locale={locale} options={amountOptions(quote.c)} />
                ) : '—'}
            </PriceFlash>
            <div className="bento-foot">
                {quote?.c ? (
                    <>
                        <ChangePill value={quote.dp} />
                        <span className="num truncate">{t('vsPrevClose', { change: formatNumber(quote.d ?? 0, locale, { ...amountOptions(quote.d ?? 0), signDisplay: 'exceptZero' }) })}</span>
                    </>
                ) : (
                    <span>{t('unavailable')}</span>
                )}
            </div>
        </Link>
    );
}
