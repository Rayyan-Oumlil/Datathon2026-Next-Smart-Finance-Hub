// The app ships in exactly two languages. The saved choice lives in a cookie; without one, the
// browser's Accept-Language decides, and anything else falls back to English.
export const LOCALES = ['en', 'fr'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_COOKIE = 'NEXT_LOCALE';

// Each language is named in its own language, so anyone can find theirs.
export const LOCALE_NAMES: Record<Locale, string> = { en: 'English', fr: 'Français' };

export const isLocale = (value: unknown): value is Locale => LOCALES.includes(value as Locale);

// Message keys for data titles that live in lib/ ("Consumer & health" -> "consumerHealth")
export const toMessageKey = (text: string) =>
    text.replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : '')).replace(/^./, (c) => c.toLowerCase());
