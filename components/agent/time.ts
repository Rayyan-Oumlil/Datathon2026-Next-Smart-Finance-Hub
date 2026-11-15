import { formatDateTime } from '@/i18n/format';

// A date without a time is shown as a date: read as a timestamp it would shift by the viewer's time zone.
// A full timestamp is shown in Québec time. An unreadable value gives ''.
export const formatMoment = (iso: string | undefined, locale: string): string => {
    if (!iso) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return formatDateTime(iso, locale, { dateStyle: 'medium', timeZone: 'UTC' });
    const time = new Date(iso);
    return Number.isNaN(time.getTime()) ? '' : formatDateTime(iso, locale);
};

type Lookup = { has: (key: any) => boolean } & ((key: any) => string);

// Source names are provider names ("Finnhub"), except the two the app writes itself: "demo data" and "derived".
// Those read in the active language through the namespace's `sourceNames` block; any other name is shown as given.
export const sourceLabel = (t: Lookup, source: string): string => {
    const key = `sourceNames.${source.toLowerCase().replace(/[^a-z]/g, '')}`;
    return t.has(key) ? t(key) : source;
};
