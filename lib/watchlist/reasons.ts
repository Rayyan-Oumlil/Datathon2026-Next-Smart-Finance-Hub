import type { HoldingsSummary, Pick as WatchlistPick, ReasonSentence } from '@/lib/domain/types';
import { RULES, type Rules } from '@/lib/rules';
import { normalize, numberOf, own, type ProfileView } from '@/lib/watchlist/format';

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

/** True when the text holds one of the never-words of the rules file: whole word, any case, simple inflections included. */
export function containsNeverWord(text: string, rules: Rules = RULES): boolean {
    return neverWordPattern(rules).test(text);
}

type Inputs = { pick: WatchlistPick; profile: ProfileView; holdings: HoldingsSummary; sectorOf: Record<string, string> };
type Filled = { text: string; sources: string[] } | null;

// The sign follows the rounded number shown, so a move of -0.04 reads "0.0", never "-0.0" or "+0.0".
function signed(value: number): string {
    const text = value.toFixed(1);
    const shown = Number(text);
    return shown === 0 ? '0.0' : shown > 0 ? `+${text}` : text;
}

// One function per allowed template id. Each returns null unless every field it needs is present.
const TEMPLATES: Record<string, (inputs: Inputs) => Filled> = {
    same_sector_as_holding: ({ pick, holdings, sectorOf }) => {
        if (pick.sector === undefined) return null;
        const held = [...holdings.symbols].sort().find((symbol) => symbol !== pick.symbol && own(sectorOf, symbol) === pick.sector);
        return held === undefined ? null : { text: `Same sector as ${held}, which you hold`, sources: ['simulated holdings', pick.signals.entry.listSource] };
    },
    picked_sector: ({ pick, profile }) => {
        const picked = pick.sector !== undefined && profile.answers.sectors.some((sector) => normalize(sector) === normalize(pick.sector!));
        return picked ? { text: `In ${pick.sector}, a sector you picked`, sources: ['Profile config'] } : null;
    },
    brands_list: ({ pick, profile }) => {
        const listed = profile.answers.brands.some((brand) => normalize(brand) === normalize(pick.symbol));
        return listed ? { text: 'On your brands list', sources: ['Profile config'] } : null;
    },
    etf_tracks: ({ pick }) => {
        const fund = pick.signals.entry.etf;
        if (pick.assetClass !== 'etf' || !fund) return null;
        if (fund.index.trim() !== '') return { text: `ETF that tracks ${fund.index.trim()}`, sources: [fund.issuerUrl] };
        if (fund.holdings !== undefined && fund.holdings > 0) return { text: `ETF that holds ${fund.holdings} companies`, sources: [fund.issuerUrl] };
        return null;
    },
    moved: ({ pick }) => {
        const today = numberOf(pick.signals.changePercent);
        if (today !== undefined) return { text: `Moved ${signed(today)}% today`, sources: [pick.signals.changePercent!.source] };
        const closes = pick.signals.closes1m;
        const first = closes?.value[0];
        const last = closes?.value[closes.value.length - 1];
        if (closes && closes.value.length >= 2 && Number.isFinite(first) && Number.isFinite(last) && first! > 0) {
            return { text: `Moved ${signed((last! / first! - 1) * 100)}% over 1 month`, sources: [closes.source] };
        }
        return null;
    },
};

/**
 * The reason sentence of a pick: the first allowed template that applies, in the order of
 * rules.reasons.allowed_templates (same sector as a holding, picked sector, brands list, ETF facts, move).
 * A template applies only when all its fields come from data we hold. Where a template has two forms
 * ("tracks {index} / holds {n} companies", "today / over {window}"), the first form with data is used.
 * A sentence whose filled-in data would spell a never-word (a ticker such as SAFE) is skipped, so no output
 * can ever contain one. Returns null when nothing applies: the card then shows facts only.
 *
 * sectorOf maps a held symbol to its sector (the holdings summary does not carry it); without it the
 * same-sector template cannot name a ticker and does not apply.
 */
export function buildReason(
    pick: WatchlistPick,
    profile: ProfileView,
    holdings: HoldingsSummary,
    options: { sectorOf?: Record<string, string>; rules?: Rules } = {},
): ReasonSentence | null {
    const rules = options.rules ?? RULES;
    const inputs: Inputs = { pick, profile, holdings, sectorOf: options.sectorOf ?? {} };
    for (const template of rules.reasons.allowed_templates) {
        const filled = TEMPLATES[template.id]?.(inputs);
        if (filled && !containsNeverWord(filled.text, rules)) {
            return { templateId: template.id, text: filled.text, sources: filled.sources };
        }
    }
    return null;
}
