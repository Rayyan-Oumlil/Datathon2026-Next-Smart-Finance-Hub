// The language a message is written in, so the agent answers in it: a question in French gets a French answer, one in
// English an English answer, whatever the app is set to. Plain code, no model: the same text always gives the same
// language, and a message with no language of its own (a ticker, "ok") says nothing and the caller falls back.

import type { Locale } from '@/i18n/config';

const FRENCH = `
le la les des du de un une et est sont que qui quoi pour dans sur avec sans je tu il elle nous vous ils elles
mon ma mes ton ta tes notre nos votre vos ce cet cette ces au aux ne pas quel quelle quels quelles comment pourquoi
quand où combien ajoute ajouter ajoutez montre montrer montrez affiche affichez explique expliquer expliquez
veux voudrais peux pouvez voir faire fait être suis sommes êtes avons avez ont liste portefeuille titre titres
bourse fonds fnb reer celi merci bonjour salut oui svp aussi mais ou donc car très tout tous toutes rien cela ça ceci
entre vers chez depuis pendant selon parmi en moi toi bien peut doit dois sert moins différence
`;

const ENGLISH = `
the is are was were what which who why how when where do does did can could should would will my your our their
this that these those and or of to for in at with without from by be been am i you he she we they it us them add
show explain tell want like need please hello hi hey thanks thank yes portfolio stock stocks watchlist price prices
list fund funds rule rules create much many about into than then there here if also just less more most all any some
buy sell cash left below above difference between
`;

// Words are compared without accents too, so French typed without them is still French
const plain = (word: string) => word.normalize('NFD').replace(/\p{M}/gu, '');
const set = (words: string) => new Set(words.split(/\s+/).filter(Boolean).flatMap((word) => [word, plain(word)]));
const FRENCH_WORDS = set(FRENCH);
const ENGLISH_WORDS = set(ENGLISH);

// l'ETF, d'abord, qu'est, j'ai: the part before the apostrophe. English contractions put the apostrophe later
// (it's, don't, I'm), so their first part is never one of these.
const ELISION = new Set(['l', 'd', 'j', 'qu', 'c', 'n', 's', 'm', 't', 'jusqu', 'lorsqu', 'puisqu']);
const ACCENTED = /[àâäçéèêëîïôöùûüÿœæ]/;

// Only letters (with an apostrophe inside a word) count; numbers and punctuation are ignored
const WORD = /\p{L}+(?:['’]\p{L}+)*/gu;

// Symbols such as XIU.TO, BRK.B or BTC-USD: their suffix ("TO") would otherwise be read as a word of the language
const SYMBOL = /(?<![\p{L}\d])[A-Z0-9]{1,8}(?:[.\-][A-Z0-9]{1,5})+(?![\p{L}\d])/gu;

// Margin by which one language must lead; below it the text has no language of its own
const MARGIN = 1;

/** "en", "fr", or null when the text is neither (a ticker, a number, "ok") or as much one as the other. */
export function detectLanguage(text: string): Locale | null {
    let french = 0;
    let english = 0;
    for (const match of text.normalize('NFC').replace(SYMBOL, ' ').toLowerCase().matchAll(WORD)) {
        const parts = match[0].split(/['’]/);
        if (parts.length > 1 && ELISION.has(parts[0])) french += 2;
        for (const part of parts) {
            if (FRENCH_WORDS.has(part)) french += 1;
            if (ENGLISH_WORDS.has(part)) english += 1;
            if (ACCENTED.test(part)) french += 1;
        }
    }
    if (french - english >= MARGIN) return 'fr';
    if (english - french >= MARGIN) return 'en';
    return null;
}

export type LanguageBasis = 'message' | 'conversation' | 'app';
export type Turn = { role: 'user' | 'assistant'; text: string };

/**
 * The language of the reply: the message's own, else the most recent turn of the conversation that has one, else
 * the app's. The basis says which, so the action log can show why a reply came in that language.
 */
export function replyLanguage(message: string, history: readonly Turn[], appLocale: Locale): { locale: Locale; basis: LanguageBasis } {
    const own = detectLanguage(message);
    if (own) return { locale: own, basis: 'message' };
    for (let i = history.length - 1; i >= 0; i -= 1) {
        const earlier = detectLanguage(history[i].text);
        if (earlier) return { locale: earlier, basis: 'conversation' };
    }
    return { locale: appLocale, basis: 'app' };
}
