'use client';

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { isRealtime } from "@/lib/market-data";
import { formatDateTime } from "@/i18n/format";

// Honest label for how old a number is: "Live" in realtime mode, otherwise the time of the last trade.
// The time is formatted after mount, in Québec time and the active language.
const DataFreshness = ({ tradeTime }: { tradeTime?: number }) => {
    const t = useTranslations('DataFreshness');
    const locale = useLocale();
    const [asOf, setAsOf] = useState<string | null>(null);

    useEffect(() => {
        setAsOf(tradeTime
            ? formatDateTime(new Date(tradeTime * 1000).toISOString(), locale, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
            : null);
    }, [tradeTime, locale]);

    if (isRealtime) {
        return <span className="inline-flex items-center gap-1.5 text-[12px] text-faint"><span className="live-dot" /> {t('live')}</span>;
    }
    return <span className="text-[12px] text-faint">{asOf ? t('asOf', { time: asOf }) : t('delayed')}</span>;
};

// Same component under the name pages import
export const LocalizedDataFreshness = DataFreshness;

export default DataFreshness;
