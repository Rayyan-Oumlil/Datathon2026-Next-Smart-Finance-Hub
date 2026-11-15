import type { OnboardingAnswers } from '@/lib/domain/types';

// The words shown for each stored answer value. Onboarding, its result screen and the Profile tab all read
// from here, so an answer is always described the same way. The stored values themselves never change.

export type Option = { value: string; label: string; hint?: string };

export const GOAL: Option[] = [
    { value: 'learn', label: 'Learn' },
    { value: 'track', label: 'Track' },
    { value: 'find ideas', label: 'Find ideas' },
];
export const TRADED: Option[] = [
    { value: 'yes', label: 'Yes' },
    { value: 'no', label: 'No' },
];
export const EXPERIENCE: Option[] = [
    { value: '<1y', label: 'Less than 1 year' },
    { value: '1-5y', label: '1 to 5 years' },
    { value: '5+y', label: '5 years or more' },
];
export const TOOLS: Option[] = [
    { value: 'limit_or_stop', label: 'Limit / stop orders' },
    { value: 'options', label: 'Options' },
    { value: 'margin_or_shorting', label: 'Margin or shorting' },
];
export const INVESTING_GOAL: Option[] = [
    { value: 'income', label: 'Income' },
    { value: 'growth', label: 'Growth' },
    { value: 'trading', label: 'Trading' },
];
export const ECHEANCE: Option[] = [
    { value: 'weeks', label: 'Weeks' },
    { value: 'months', label: 'Months' },
    { value: '1 yr', label: '1 year' },
    { value: '5+ yrs', label: '5 years or more' },
];
// The board's wording for the first and last choice uses words this app never shows; the stored values are unchanged.
export const DROP20: Option[] = [
    { value: 'sell', label: 'Reduce my position' },
    { value: 'wait', label: 'Wait' },
    { value: 'buy_more', label: 'Add to my position' },
];
export const SELF_RATING: Option[] = [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
];
export const MARKETS: Option[] = [
    { value: 'US', label: 'US' },
    { value: 'Canada', label: 'Canada' },
    { value: 'global', label: 'Global', hint: 'US and Canada' },
];
export const AGENT_STYLE: Option[] = [
    { value: 'teach me', label: 'Teach me' },
    { value: 'suggest', label: 'Suggest' },
    { value: 'just the data', label: 'Just the data' },
];

export const labelOf = (options: Option[], value: string | undefined): string =>
    options.find((option) => option.value === value)?.label ?? value ?? 'not answered';

// The ESG tag is hand-set mock data and is labelled so wherever it appears.
export const themeLabel = (theme: string): string => (theme === 'ESG' ? 'ESG (demo data)' : theme);

const list = (values: string[] | undefined, empty = 'No preference'): string => (values?.length ? values.join(', ') : empty);

/** Every stored answer as a question and a plain-word value, in the order the questions are asked. */
export function describeAnswers(a: OnboardingAnswers): Array<{ question: string; answer: string }> {
    return [
        { question: 'What brings you here', answer: labelOf(GOAL, a.goal) },
        { question: 'Placed a trade yourself', answer: a.traded ? 'Yes' : 'No' },
        ...(a.traded
            ? [
                { question: 'Trading experience', answer: labelOf(EXPERIENCE, a.experience) },
                { question: 'Tools used', answer: list(a.tools?.map((tool) => labelOf(TOOLS, tool)), 'None of these') },
            ]
            : []),
        { question: 'Investing goal', answer: labelOf(INVESTING_GOAL, a.investingGoal) },
        { question: 'When you want to see progress', answer: labelOf(ECHEANCE, a.echeance) },
        { question: 'If it dropped 20%', answer: labelOf(DROP20, a.drop20) },
        { question: 'Self-rated risk', answer: labelOf(SELF_RATING, a.selfRating) },
        { question: 'Markets', answer: labelOf(MARKETS, a.markets) },
        { question: 'Sectors', answer: list(a.sectors) },
        { question: 'Niches', answer: list(a.niches) },
        { question: 'Themes', answer: list(a.themes?.map(themeLabel)) },
        { question: 'Brands you know', answer: list(a.brands, 'None') },
        { question: 'Avoid list', answer: list(a.avoid, 'Nothing excluded') },
        { question: 'Agent style', answer: labelOf(AGENT_STYLE, a.agentStyle) },
    ];
}
