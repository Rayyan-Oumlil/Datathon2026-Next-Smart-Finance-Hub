import type { HoldingsSummary, Pick as WatchlistPick, ReasonSentence } from '@/lib/domain/types';
import { RULES, type Rules } from '@/lib/rules';
import { normalize, numberOf, own, type ProfileView } from '@/lib/watchlist/format';
import { renderText, type Locale, type TextRef } from '@/lib/watchlist/text';

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** One listed word, also in its simple inflections: "buy" -> buys, buying; "safe" -> safer, safely; "recommended" -> recommend, recommends ... */
function wordPattern(word: string): string {
    // Back to a base form first: "recommended" -> "recommend", "fits" -> "fit".
    const stem = word.length > 5 && word.endsWith('ed') ? word.slice(0, -2) : word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word;
    // "fits you" must also catch "fits your profile".
    if (stem === 'you') return 'you(?:r|rs)?';
    // A final consonant after a vowel may double: "fit" -> fitting, fitted.
    const doubled = /[aeiou][b-df-hj-np-tvz]$/.test(stem) ? `${stem.slice(-1)}?` : '';
    return stem.endsWith('e')
        ? `${escapeRegExp(stem.slice(0, -1))}(?:e(?:s|d|r|rs|st|ly)?|ing)`
        : `${escapeRegExp(stem)}(?:s|es|${doubled}(?:ed|ing)|ation|ations)?`;
}

function neverWordPattern(rules: Rules): RegExp {
    const phrases = rules.reasons.never_words.map((phrase) => phrase.trim().toLowerCase().split(/\s+/).map(wordPattern).join('[\\s-]+'));
    return new RegExp(`(?<![a-z])(?:${phrases.join('|')})(?![a-z])`, 'i');
}

/**
 * The French list: each entry as written, plus its plural and feminine forms ("bon" -> bons, bonne is listed;
 * "recommandé" -> recommandée, recommandés). Accents count ("sûr" is listed, "sur" is not), case does not, and a
 * word is whole only between non-letters, so "bon" never matches "bonus", "Bonterra" or "obligation", and "sûr"
 * never matches "sûreté". An elided form ("l’achat", "d'achat") is a whole word after its apostrophe.
 */
function frenchNeverWordPattern(words: string[]): RegExp | null {
    if (words.length === 0) return null;
    const phrases = words.map((phrase) => phrase.normalize('NFC').trim().toLowerCase().split(/\s+/).map(escapeRegExp).join('[\\s\u00a0-]+') + '(?:e|es|s)?');
    return new RegExp(`(?<![\\p{L}\\p{N}])(?:${phrases.join('|')})(?![\\p{L}\\p{N}])`, 'iu');
}

/**
 * True when the text holds one of the never-words of the rules file, in either language: the English list
 * (reasons.never_words: whole word, any case, simple inflections included) and the French list
 * (reasons.never_words_fr: whole word, any case, accents significant). Both lists are checked on every text, so a
 * sentence is judged the same way whatever language it is in.
 */
export function containsNeverWord(text: string, rules: Rules = RULES): boolean {
    const normalized = text.normalize('NFC');
    if (neverWordPattern(rules).test(normalized)) return true;
    const french = frenchNeverWordPattern((rules.reasons as { never_words_fr?: string[] }).never_words_fr ?? []);
    return french !== null && french.test(normalized);
}

type Inputs = { pick: WatchlistPick; profile: ProfileView; holdings: HoldingsSummary; sectorOf: Record<string, string> };
type Filled = { params: Record<string, string | number | null>; sources: string[] } | null;

// One function per allowed template id. Each returns null unless every field it needs is present. The sentence
// itself is the catalog's ('reason.<id>' in lib/watchlist/text.ts), in the wording of rules.reasons.allowed_templates.
const TEMPLATES: Record<string, (inputs: Inputs) => Filled> = {
    same_sector_as_holding: ({ pick, holdings, sectorOf }) => {
        if (pick.sector === undefined) return null;
        const held = [...holdings.symbols].sort().find((symbol) => symbol !== pick.symbol && own(sectorOf, symbol) === pick.sector);
        return held === undefined ? null : { params: { ticker: held }, sources: ['simulated holdings', pick.signals.entry.listSource] };
    },
    picked_sector: ({ pick, profile }) => {
        const picked = pick.sector !== undefined && profile.answers.sectors.some((sector) => normalize(sector) === normalize(pick.sector!));
        return picked ? { params: { sector: pick.sector! }, sources: ['Profile config'] } : null;
    },
    brands_list: ({ pick, profile }) => {
        const listed = profile.answers.brands.some((brand) => normalize(brand) === normalize(pick.symbol));
        return listed ? { params: {}, sources: ['Profile config'] } : null;
    },
    etf_tracks: ({ pick }) => {
        const fund = pick.signals.entry.etf;
        if (pick.assetClass !== 'etf' || !fund) return null;
        if (fund.index.trim() !== '') return { params: { index: fund.index.trim(), holdings: null }, sources: [fund.issuerUrl] };
        if (fund.holdings !== undefined && fund.holdings > 0) return { params: { index: null, holdings: fund.holdings }, sources: [fund.issuerUrl] };
        return null;
    },
    moved: ({ pick }) => {
        const today = numberOf(pick.signals.changePercent);
        if (today !== undefined) return { params: { change: today, window: 'today' }, sources: [pick.signals.changePercent!.source] };
        const closes = pick.signals.closes1m;
        const first = closes?.value[0];
        const last = closes?.value[closes.value.length - 1];
        if (closes && closes.value.length >= 2 && Number.isFinite(first) && Number.isFinite(last) && first! > 0) {
            return { params: { change: (last! / first! - 1) * 100, window: '1m' }, sources: [closes.source] };
        }
        return null;
    },
};

/**
 * The reason sentence of a pick: the first allowed template that applies, in the order of
 * rules.reasons.allowed_templates (same sector as a holding, picked sector, brands list, ETF facts, move).
 * A template applies only when all its fields come from data we hold. Where a template has two forms
 * ("tracks {index} / holds {n} companies", "today / over {window}"), the first form with data is used.
 *
 * The never-word guard runs on the filled-in sentence, in English AND in French, against both lists: a sentence
 * whose data would spell a never-word in either language (a ticker such as SAFE, an index named "Bon Appétit
 * Group") is skipped, so no output can ever contain one, and the template chosen never depends on the language.
 * The guard does not blank the placeholders: a proper noun that is itself a never-word as a whole word skips the
 * template (the cautious choice); one that only contains it ("Bonterra", "Goodyear") does not, since matching is by
 * whole word. Returns null when nothing applies: the card then shows facts only.
 *
 * sectorOf maps a held symbol to its sector (the holdings summary does not carry it); without it the
 * same-sector template cannot name a ticker and does not apply. The text is written in options.locale (English
 * by default); textRef holds the template id and its values, to write it again in the other language.
 */
export function buildReason(
    pick: WatchlistPick,
    profile: ProfileView,
    holdings: HoldingsSummary,
    options: { sectorOf?: Record<string, string>; rules?: Rules; locale?: Locale } = {},
): ReasonSentence | null {
    const rules = options.rules ?? RULES;
    const inputs: Inputs = { pick, profile, holdings, sectorOf: options.sectorOf ?? {} };
    for (const template of rules.reasons.allowed_templates) {
        const filled = TEMPLATES[template.id]?.(inputs);
        if (!filled) continue;
        const textRef: TextRef = { key: `reason.${template.id}`, params: filled.params };
        const english = renderText(textRef, 'en');
        const french = renderText(textRef, 'fr');
        if (containsNeverWord(english, rules) || containsNeverWord(french, rules)) continue;
        return { templateId: template.id, text: options.locale === 'fr' ? french : english, sources: filled.sources, textRef };
    }
    return null;
}
