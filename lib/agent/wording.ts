// The web side's last wording check on an agent reply, after the agent service's own (agent/app/checks.py).
// English never-words: rules/v1.json reasons.never_words, through the reason sentences' own check.
// French never-words: rules/v1.json reasons.never_words_fr when present, else the list below.
// Judgement and prediction words: the same lists as agent/app/checks.py (a test keeps the two in step).
// Whole words, any letter case, accents significant ("sur" is not "sûr"), text compared in Unicode NFC form.
// Quoted data: the exact names of the app's own assets (data/universe.json) and of the watchlist picks may be
// written as they are, when 2 to 6 words and at most 60 characters long, so "Best Buy Co., Inc." can be named.

import { RULES } from '@/lib/rules';
import { getUniverse } from '@/lib/universe';
import { containsNeverWord } from '@/lib/watchlist/reasons';

export const NEVER_WORDS_FR_DEFAULT = [
    'acheter', 'achetez', 'achat', 'vendre', 'vendez', 'vente', 'devriez', 'devrait', 'devez', 'il faut', 'bon',
    'bonne', 'sûr', 'sûre', 'sécuritaire', 'sans risque', 'va monter', 'va augmenter', 'vous convient',
    'recommandé', 'recommandée', 'recommandons', 'conseillé', 'conseillons',
];

export const JUDGEMENT_WORDS = [
    'better', 'best', 'worse', 'worst', 'excellent', 'great', 'attractive', 'undervalued', 'overvalued', 'cheap',
    'expensive', 'ideal', 'suits', 'suitable', 'strong pick', 'top pick', 'promising', 'bargain', 'outperform',
    'underperform', 'will go up', 'will go down', 'will fall', 'will drop', 'likely to rise', 'likely to fall',
    'worth owning',
];
export const JUDGEMENT_WORDS_FR = [
    'meilleur', 'pire', 'excellent', 'attrayant', 'sous-évalué', 'surévalué', 'aubaine', 'idéal', 'prometteur',
    'va baisser', 'va chuter', 'susceptible de monter', 'vaut la peine',
];

// Inflections checked on top of the listed word itself (the same as agent/app/checks.py).
const INFLECTIONS: Record<string, string[]> = {
    acheter: ['achète', 'achètes', 'achètent', 'achetons', 'acheté', 'achetée', 'achetés', 'achetées', 'achèterait', 'achèteriez', 'achetant', 'achete', 'achetent'],
    achat: ['achats'],
    vendre: ['vends', 'vend', 'vendent', 'vendons', 'vendu', 'vendue', 'vendus', 'vendues', 'vendrait', 'vendriez', 'vendant'],
    vente: ['ventes'],
    devriez: ['devrais', 'devrions'],
    devrait: ['devraient'],
    'il faut': ['il faudrait', 'il faudra'],
    bon: ['bons'],
    bonne: ['bonnes'],
    'sûr': ['sûrs'],
    'sûre': ['sûres'],
    'sécuritaire': ['sécuritaires', 'securitaire', 'securitaires'],
    'sans risque': ['sans risques', 'sans aucun risque'],
    'va monter': ['vont monter', 'va remonter', 'vont remonter'],
    'va augmenter': ['vont augmenter'],
    'vous convient': ['vous conviennent', 'vous conviendrait', 'vous conviendraient'],
    'recommandé': ['recommandés', 'recommande', 'recommandes', 'recommandez', 'recommandent', 'recommander', 'recommandation', 'recommandations'],
    'recommandée': ['recommandées'],
    'conseillé': ['conseillés', 'conseille', 'conseilles', 'conseillez', 'conseillent'],
    'conseillée': ['conseillées'],
    better: [], best: [], worse: [], worst: [], great: [],
    meilleur: ['meilleure', 'meilleurs', 'meilleures'],
    pire: ['pires'],
    excellent: ['excellente', 'excellents', 'excellentes'],
    attrayant: ['attrayante', 'attrayants', 'attrayantes'],
    'sous-évalué': ['sous-évaluée', 'sous-évalués', 'sous-évaluées'],
    'surévalué': ['surévaluée', 'surévalués', 'surévaluées'],
    aubaine: ['aubaines'],
    'idéal': ['idéale', 'idéaux', 'idéales'],
    prometteur: ['prometteuse', 'prometteurs', 'prometteuses'],
    'va baisser': ['vont baisser'],
    'va chuter': ['vont chuter'],
    'susceptible de monter': ['susceptibles de monter'],
    'vaut la peine': ['valent la peine'],
};

// Fixed phrases that hold a listed word without advising or judging anything.
const EXEMPT_PHRASES = ['bien sûr', 'bon du Trésor', 'bons du Trésor', 'bon de souscription', 'bons de souscription', 'best ask', 'best bid', 'meilleur cours acheteur', 'meilleur cours vendeur'];

const MAX_NAME_CHARS = 60;
const MAX_NAME_WORDS = 6;

export function neverWordsFr(): string[] {
    const listed = (RULES.reasons as { never_words_fr?: string[] }).never_words_fr;
    return listed && listed.length > 0 ? listed : NEVER_WORDS_FR_DEFAULT;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const nfc = (text: string) => text.normalize('NFC');
// A listed form as a pattern body: spaces match any run of spaces, a hyphen also matches a space.
const body = (form: string) => nfc(form).trim().split(/\s+/).map((part) => escapeRegExp(part).replace(/-/g, '[-‑ ]?')).join('\\s+');
// Letters and digits of any script count as part of a word, so "bonus" does not hold "bon" nor "sûrement" "sûr".
const whole = (forms: string[], flags = 'iu') => new RegExp(`(?<![\\p{L}\\p{N}_])(?:${forms.map(body).join('|')})(?![\\p{L}\\p{N}_])`, flags);
const formsOf = (words: string[]) => words.flatMap((word) => [word, ...(INFLECTIONS[word] ?? [])]);

let cached: { listed: RegExp; exempt: RegExp; names: string[] } | null = null;
function patterns() {
    if (cached) return cached;
    const listed = whole(formsOf([...neverWordsFr(), ...JUDGEMENT_WORDS, ...JUDGEMENT_WORDS_FR]));
    // Only the asset names that hold a listed word need taking out
    const names = getUniverse().map((entry) => entry.name).filter((name) => isQuotable(name) && (listed.test(nfc(name)) || containsNeverWord(name)));
    cached = { listed, exempt: whole(EXEMPT_PHRASES, 'giu'), names };
    return cached;
}

function isQuotable(name: string): boolean {
    const words = name.trim().split(/\s+/);
    return words.length >= 2 && words.length <= MAX_NAME_WORDS && name.length <= MAX_NAME_CHARS;
}

function withoutNames(text: string, names: string[]): string {
    let out = text;
    for (const name of [...names].sort((a, b) => b.length - a.length)) {
        out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(nfc(name).trim())}(?![\\p{L}\\p{N}_])`, 'giu'), ' ');
    }
    return out;
}

/**
 * True when the text holds a never-word (English or French) or a judgement word (English or French), outside the
 * quotable names and the fixed phrases. `names` adds names the request's own data holds (the watchlist picks).
 */
export function failsWordCheck(text: string, names: string[] = []): boolean {
    const { listed, exempt, names: assetNames } = patterns();
    const cleaned = withoutNames(nfc(text), [...assetNames, ...names.filter(isQuotable)]).replace(exempt, ' ');
    return containsNeverWord(cleaned) || listed.test(cleaned);
}
