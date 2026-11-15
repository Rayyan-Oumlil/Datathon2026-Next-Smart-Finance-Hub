import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
// The parser next-intl itself uses (via use-intl)
import { parse, type MessageFormatElement } from '@formatjs/icu-messageformat-parser';
import { DEFAULT_LOCALE, LOCALES } from '@/i18n/config';

// messages/<locale>/<Namespace>.json, the layout i18n/messages.ts loads
const ROOT = path.join(__dirname, '..', 'messages');
type Tree = { [key: string]: string | Tree };
const namespaces = (locale: string) => readdirSync(path.join(ROOT, locale)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
const load = (locale: string, ns: string): Tree => JSON.parse(readFileSync(path.join(ROOT, locale, `${ns}.json`), 'utf8'));
const flat = (tree: Tree, prefix = ''): Record<string, string> =>
    Object.fromEntries(Object.entries(tree).flatMap(([k, v]) =>
        typeof v === 'string' ? [[prefix + k, v]] : Object.entries(flat(v, `${prefix}${k}.`))));

// The arguments and rich-text tags a message uses, at any depth
const collect = (els: MessageFormatElement[], out: Set<string>): Set<string> => {
    for (const el of els) {
        if ('value' in el && typeof el.value === 'string' && el.type !== 0) out.add(el.type === 8 ? `<${el.value}>` : el.value);
        if ('options' in el) for (const option of Object.values(el.options)) collect(option.value, out);
        if ('children' in el) collect(el.children, out);
    }
    return out;
};
const args = (msg: string) => collect(parse(msg), new Set());

// French values that may read exactly like the English: proper nouns, symbols, words spelled the same.
// Keep it short; anything else identical is an untranslated string.
const SAME_IN_BOTH = new Set(['Canada', 'MACD', 'Stable', '{value} mentions']);
// No letters left once the arguments are removed ("{symbol}", "⌘K"): nothing to translate
const nothingToTranslate = (msg: string) => !/\p{L}/u.test(msg.replace(/\{[^}]*\}/g, '').replace(/⌘K/g, ''));

// Words this app never shows, in either language: they read as advice or a promise (docs/spec.md)
const FORBIDDEN = [
    'buy', 'buys', 'buying', 'bought', 'sell', 'sells', 'selling', 'sold', 'should', 'good',
    'safe', 'safer', 'safest', 'safely', 'will rise', 'fits you',
    'recommend', 'recommends', 'recommended', 'recommending', 'recommendation', 'recommendations',
    'acheter', 'achetez', 'achète', 'achètes', 'vendre', 'vendez', 'vends',
    'devriez', 'devrait', 'devraient', 'il faut', 'bon', 'bonne', 'bons', 'bonnes',
    'sûr', 'sûre', 'sûrs', 'sûres', 'sécuritaire', 'sécuritaires', 'sans risque',
    'va monter', 'va augmenter', 'vous convient', 'vous conviennent',
    'recommandé', 'recommandée', 'recommandés', 'recommandées', 'recommandons',
    'conseillé', 'conseillée', 'conseillés', 'conseillées',
];
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '[\\s\\u00a0]+');
// Whole word, any case: a letter or digit on either side means it is part of another word
const forbidden = new RegExp(`(?<![\\p{L}\\p{N}])(?:${FORBIDDEN.map(escape).join('|')})(?![\\p{L}\\p{N}])`, 'iu');

describe('message files', () => {
    it('ships exactly English and French, English by default', () => {
        expect([...LOCALES].sort()).toEqual(['en', 'fr']);
        expect(DEFAULT_LOCALE).toBe('en');
        expect(readdirSync(ROOT).filter((f) => !f.startsWith('.')).sort()).toEqual(['en', 'fr']);
    });

    it('has the same namespace files in both languages', () => {
        expect(namespaces('fr')).toEqual(namespaces('en'));
        expect(namespaces('en').length).toBeGreaterThan(0);
    });

    for (const ns of namespaces('en')) {
        describe(ns, () => {
            const en = flat(load('en', ns));
            const fr = flat(load('fr', ns));

            it('has identical keys in en and fr', () => {
                expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
            });

            it('parses, and keeps every argument and tag', () => {
                for (const [key, msg] of Object.entries(en)) {
                    if (fr[key] === undefined) continue;
                    const theirs = args(fr[key]);
                    for (const arg of args(msg)) expect(theirs.has(arg), `fr:${ns}.${key} lost ${arg}`).toBe(true);
                }
            });

            it('translates every French value', () => {
                for (const [key, msg] of Object.entries(fr)) {
                    expect(msg.trim(), `fr:${ns}.${key} is empty`).not.toBe('');
                    if (msg === en[key] && !SAME_IN_BOTH.has(msg) && !nothingToTranslate(msg)) {
                        expect.fail(`fr:${ns}.${key} is the English text "${msg}"`);
                    }
                }
            });

            it('uses no forbidden word', () => {
                for (const [locale, messages] of [['en', en], ['fr', fr]] as const) {
                    for (const [key, msg] of Object.entries(messages)) {
                        expect(msg.match(forbidden)?.[0], `${locale}:${ns}.${key}: "${msg}"`).toBeUndefined();
                    }
                }
            });
        });
    }

    it('catches forbidden words as whole words only', () => {
        expect(forbidden.test('Should you buy?')).toBe(true);
        expect(forbidden.test('Un placement sûr')).toBe(true);
        expect(forbidden.test('Il est recommandé de')).toBe(true);
        expect(forbidden.test('il\u00a0faut')).toBe(true);
        expect(forbidden.test('Goodwill, buyback, bonification, Bonjour')).toBe(false);
    });
});
