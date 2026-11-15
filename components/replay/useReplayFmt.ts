'use client';

import { useMemo } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { formatDateTime, formatMoney, formatNumber, formatPercent } from '@/i18n/format';

/** The time machine's formatters in the active language (i18n/format.ts), plus the "points" unit from the catalog. */
export function useReplayFmt() {
    const locale = useLocale();
    const t = useTranslations('Replay');
    return useMemo(() => {
        const money = (value: number, digits = 0) => formatMoney(value, 'CAD', locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
        const signedMoney = (value: number, digits = 0) => formatMoney(value, 'CAD', locale, { minimumFractionDigits: digits, maximumFractionDigits: digits, signDisplay: 'exceptZero' });
        const pct = (value: number, digits = 1) => formatPercent(value, locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
        const signedPct = (value: number, digits = 1) => formatPercent(value, locale, { minimumFractionDigits: digits, maximumFractionDigits: digits, signDisplay: 'exceptZero' });
        const num = (value: number, digits = 0) => formatNumber(value, locale, { maximumFractionDigits: digits });
        const qty = (value: number) => formatNumber(value, locale, { maximumFractionDigits: value >= 100 ? 2 : 4 });
        const pts = (value: number, digits = 1) => t('units.pts', { value: formatNumber(value, locale, { minimumFractionDigits: digits, maximumFractionDigits: digits, signDisplay: 'exceptZero' }) });
        // ISO calendar dates are days, not instants: format them in UTC so a time zone never shifts the day
        const date = (iso: string) => formatDateTime(`${iso}T12:00:00Z`, locale, { dateStyle: 'medium', timeZone: 'UTC' });
        const shortDate = (iso: string) => formatDateTime(`${iso}T12:00:00Z`, locale, { month: 'short', year: 'numeric', timeZone: 'UTC' });
        const dateTime = (iso: string) => formatDateTime(iso, locale);
        return { locale: locale as 'fr' | 'en', money, signedMoney, pct, signedPct, num, qty, pts, date, shortDate, dateTime };
    }, [locale, t]);
}

export type ReplayFmt = ReturnType<typeof useReplayFmt>;
