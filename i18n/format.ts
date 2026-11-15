// Number, money and date formatting in the active language, built on Intl. Pure: safe on the server
// and in the browser. English renders as en-CA and French as fr-CA, so "12.5%" / "12,5 %" and
// "$1,500.00" / "1 500,00 $" follow each language's own conventions (no hand-built separators).
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/i18n/config';

const TAGS: Record<Locale, string> = { en: 'en-CA', fr: 'fr-CA' };
/** Dates and times are shown in Québec time unless a caller passes another timeZone. */
export const DISPLAY_TIME_ZONE = 'America/Toronto';

const tag = (locale: string): string => TAGS[isLocale(locale) ? locale : DEFAULT_LOCALE];

/** 1234.5 -> "1,234.5" (en) / "1 234,5" (fr). Options are Intl.NumberFormat's. */
export function formatNumber(value: number, locale: string, options?: Intl.NumberFormatOptions): string {
    return new Intl.NumberFormat(tag(locale), options).format(value);
}

/**
 * A value already in percent: 12.5 -> "12.5%" (en) / "12,5 %" (fr). Up to 2 decimals by default;
 * pass { signDisplay: 'exceptZero' } for "+12.5%".
 */
export function formatPercent(value: number, locale: string, options?: Intl.NumberFormatOptions): string {
    return new Intl.NumberFormat(tag(locale), { style: 'percent', maximumFractionDigits: 2, ...options }).format(value / 100);
}

/** 1500, 'CAD' -> "$1,500.00" (en) / "1 500,00 $" (fr); 'USD' -> "US$1,500.00" / "1 500,00 $ US". */
export function formatMoney(amount: number, currency: string, locale: string, options?: Intl.NumberFormatOptions): string {
    return new Intl.NumberFormat(tag(locale), { style: 'currency', currency, ...options }).format(amount);
}

/**
 * An ISO timestamp -> "Nov 15, 2026, 9:30 a.m." (en) / "15 nov. 2026, 09 h 30" (fr), in Québec time.
 * Pass Intl.DateTimeFormat options to change the parts shown. An unreadable timestamp is returned as given.
 */
export function formatDateTime(iso: string, locale: string, options?: Intl.DateTimeFormatOptions): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    const parts = options && (options.dateStyle || options.timeStyle || options.year || options.month || options.day || options.hour || options.minute || options.weekday)
        ? options
        : { dateStyle: 'medium', timeStyle: 'short', ...options } as Intl.DateTimeFormatOptions;
    return new Intl.DateTimeFormat(tag(locale), { timeZone: DISPLAY_TIME_ZONE, ...parts }).format(date);
}
