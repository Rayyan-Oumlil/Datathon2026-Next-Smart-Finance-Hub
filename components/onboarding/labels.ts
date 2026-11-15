import { createTranslator } from 'next-intl';
import type { OnboardingAnswers } from '@/lib/domain/types';
import { formatPercent } from '@/i18n/format';
import enOnboarding from '@/messages/en/Onboarding.json';

// The words shown for each stored answer value. Onboarding, its result screen and the Profile tab all read
// from here, so an answer is always described the same way. The stored values themselves never change.
// Every label is a message in the Onboarding namespace; a function here takes the translator for it
// (useTranslations('Onboarding') in a client component, getTranslations('Onboarding') on the server).

/** The shape of a translator, so these helpers work with both the client and the server one. */
export type Translator = (key: string, values?: Record<string, string | number>) => string;

export type Option = { value: string; label: string; hint?: string };

// value: what is stored. key: the message under options.<group>. hint: the message under options.marketsHint.
type Def = { value: string; key: string; hint?: string };

const GROUPS = {
    goal: [{ value: 'learn', key: 'learn' }, { value: 'track', key: 'track' }, { value: 'find ideas', key: 'ideas' }],
    traded: [{ value: 'yes', key: 'yes' }, { value: 'no', key: 'no' }],
    experience: [{ value: '<1y', key: 'lessThan1y' }, { value: '1-5y', key: 'oneToFive' }, { value: '5+y', key: 'fivePlus' }],
    tools: [
        { value: 'limit_or_stop', key: 'limitStop' },
        { value: 'options', key: 'options' },
        { value: 'margin_or_shorting', key: 'marginShorting' },
    ],
    investingGoal: [{ value: 'income', key: 'income' }, { value: 'growth', key: 'growth' }, { value: 'trading', key: 'trading' }],
    echeance: [
        { value: 'weeks', key: 'weeks' },
        { value: 'months', key: 'months' },
        { value: '1 yr', key: 'oneYear' },
        { value: '5+ yrs', key: 'fivePlus' },
    ],
    // The board's wording for the first and last choice uses words this app never shows; the stored values are unchanged.
    drop20: [{ value: 'sell', key: 'reduce' }, { value: 'wait', key: 'wait' }, { value: 'buy_more', key: 'add' }],
    selfRating: [{ value: 'low', key: 'low' }, { value: 'medium', key: 'medium' }, { value: 'high', key: 'high' }],
    markets: [{ value: 'US', key: 'us' }, { value: 'Canada', key: 'canada' }, { value: 'global', key: 'global', hint: 'global' }],
    agentStyle: [{ value: 'teach me', key: 'teach' }, { value: 'suggest', key: 'suggest' }, { value: 'just the data', key: 'data' }],
} satisfies Record<string, Def[]>;

export type OptionGroup = keyof typeof GROUPS;

/** The choices of one question, worded in the active language. */
export const optionsOf = (t: Translator, group: OptionGroup): Option[] =>
    (GROUPS[group] as Def[]).map((def) => ({
        value: def.value,
        label: t(`options.${group}.${def.key}`),
        ...(def.hint ? { hint: t(`options.marketsHint.${def.hint}`) } : {}),
    }));

/** One stored value in words. Empty gives "not answered"; a value this app does not know is shown as it is. */
export const labelOf = (t: Translator, group: OptionGroup, value: string | undefined): string => {
    if (value === undefined) return t('describe.notAnswered');
    const def = (GROUPS[group] as Def[]).find((d) => d.value === value);
    return def ? t(`options.${group}.${def.key}`) : value;
};

// Names that come from the app's own data files. A name this app has no wording for is shown as it is.
const named = (t: Translator, group: 'sectors' | 'niches' | 'themes' | 'assetClasses', name: string): string => {
    const known = (enOnboarding as unknown as Record<string, Record<string, string>>)[group];
    return Object.hasOwn(known, name) ? t(`${group}.${name}`) : name;
};
export const sectorLabel = (t: Translator, sector: string) => named(t, 'sectors', sector);
export const nicheLabel = (t: Translator, niche: string) => named(t, 'niches', niche);
export const assetClassLabel = (t: Translator, assetClass: string) => named(t, 'assetClasses', assetClass);
// The ESG tag is hand-set mock data and is labelled so wherever it appears.
export const themeLabel = (t: Translator, theme: string) => named(t, 'themes', theme);

/** Sectors, tickers or other names picked in the avoid list: a sector gets its wording, a ticker stays a ticker. */
export const avoidLabel = (t: Translator, value: string) => sectorLabel(t, value);

const list = (values: string[] | undefined, empty: string): string => (values?.length ? values.join(', ') : empty);

// The English wording, for callers that do not pass a translator (the agent's profile-change preview).
// A caller that knows the active language passes its own translator.
const english: Translator = createTranslator({ locale: 'en', messages: { Onboarding: enOnboarding }, namespace: 'Onboarding' }) as unknown as Translator;

/** Every stored answer as a question and a plain-word value, in the order the questions are asked. */
export function describeAnswers(a: OnboardingAnswers, t: Translator = english, locale = 'en'): Array<{ question: string; answer: string }> {
    const q = (key: string) => t(`describe.questions.${key}`, { percent: formatPercent(20, locale) });
    return [
        { question: q('goal'), answer: labelOf(t, 'goal', a.goal) },
        { question: q('traded'), answer: a.traded ? t('describe.yes') : t('describe.no') },
        ...(a.traded
            ? [
                { question: q('experience'), answer: labelOf(t, 'experience', a.experience) },
                { question: q('tools'), answer: list(a.tools?.map((tool) => labelOf(t, 'tools', tool)), t('describe.noneOfThese')) },
            ]
            : []),
        { question: q('investingGoal'), answer: labelOf(t, 'investingGoal', a.investingGoal) },
        { question: q('echeance'), answer: labelOf(t, 'echeance', a.echeance) },
        { question: q('drop20'), answer: labelOf(t, 'drop20', a.drop20) },
        { question: q('selfRating'), answer: labelOf(t, 'selfRating', a.selfRating) },
        { question: q('markets'), answer: labelOf(t, 'markets', a.markets) },
        { question: q('sectors'), answer: list(a.sectors?.map((s) => sectorLabel(t, s)), t('describe.noPreference')) },
        { question: q('niches'), answer: list(a.niches?.map((n) => nicheLabel(t, n)), t('describe.noPreference')) },
        { question: q('themes'), answer: list(a.themes?.map((theme) => themeLabel(t, theme)), t('describe.noPreference')) },
        { question: q('brands'), answer: list(a.brands, t('describe.none')) },
        { question: q('avoid'), answer: list(a.avoid?.map((v) => avoidLabel(t, v)), t('describe.nothingExcluded')) },
        { question: q('agentStyle'), answer: labelOf(t, 'agentStyle', a.agentStyle) },
    ];
}
