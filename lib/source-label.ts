// Source labels are plain strings built in lib/sources ("TMX Money (delayed 15 min or more)") and stored as is.
// This reads the qualifiers in the active language for display only; provider names stay as given.
import type { Locale } from '@/i18n/config';
import en from '@/messages/en/Sources.json';
import fr from '@/messages/fr/Sources.json';

const WORDS: Record<Locale, typeof en> = { en, fr };

export function sourceLabel(source: string, locale: string): string {
    const w = WORDS[locale === 'fr' ? 'fr' : 'en'];
    const whole = source.trim().toLowerCase();
    if (whole === 'demo data') return w.demoData;
    if (whole === 'derived') return w.derived;
    return source
        .replace(/\(delayed 15 min or more\)/gi, `(${w.delayed})`)
        .replace(/\(unofficial\)/gi, `(${w.unofficial})`);
}
