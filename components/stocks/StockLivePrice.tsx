'use client';

import { useLocale } from "next-intl";
import ChangePill from "@/components/ChangePill";
import { LocalizedDataFreshness } from "@/components/DataFreshness";
import PriceFlash from "@/components/PriceFlash";
import { useLiveQuotes, type LiveQuote } from "@/hooks/useLiveQuotes";
import { formatMoney, formatNumber } from "@/i18n/format";

const StockLivePrice = ({ symbol, initial, currency }: { symbol: string; initial: LiveQuote | null; currency: string }) => {
    const locale = useLocale();
    const live = useLiveQuotes([symbol]);
    const quote = live[symbol] ?? initial;

    return (
        <div className="flex items-end gap-3">
            <PriceFlash value={quote?.c} className="bento-value px-1 text-[32px]">
                {quote?.c ? formatMoney(quote.c, currency, locale) : '—'}
            </PriceFlash>
            <div className="flex flex-col items-start gap-1 pb-0.5">
                <span className="flex items-center gap-2">
                    <ChangePill value={quote?.dp} />
                    <span className="num text-[12px] text-faint">
                        {quote?.d != null ? formatNumber(quote.d, locale, { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'exceptZero' }) : ''}
                    </span>
                </span>
                <LocalizedDataFreshness tradeTime={quote?.t} />
            </div>
        </div>
    );
};

export default StockLivePrice;
