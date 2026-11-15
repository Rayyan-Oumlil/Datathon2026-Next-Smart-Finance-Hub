// The stored example users (brief B7), plus the two demo profiles (novice, expert) used for the video. Data only; lib/personas/index.ts seeds them through the normal
// profile and trade services. Level and risk are never given here: the onboarding answers below are scored by
// rules/v1.json like anyone else's (risk points: goal + échéance + 20 % drop + self-rating, bands 0-2 / 3-5 / 6-8).
// If an answer stops giving the expected risk, change the answer here, never the rule (__tests__/personas).

import type { Level, OnboardingAnswers, Risk } from '@/lib/domain/types';

// Lower-case letters only: the session id is `persona-<name>` and lib/personas reads it back with /[a-z]+/.
// The demo profiles are also reachable at /u/demo-novice and /u/demo-expert (PERSONA_ALIASES).
export type PersonaName = 'amira' | 'mateo' | 'robert' | 'novice' | 'expert';

export type PersonaPreset = {
    name: PersonaName;
    displayName: string;
    age: number;
    capitalCad: number;
    // The real horizon in years; onboarding only offers coarse buckets, so the answer is the closest one
    horizonYears: { min: number; max: number };
    description: { fr: string; en: string };
    expectedLevel: Level;     // what the answers must compute to (checked by the persona tests, never forced)
    expectedRisk: Risk;       // same
    answers: OnboardingAnswers;
    // Starting weights in percent of the capital, by app universe symbol. They sum to 100.
    weights: Record<string, number>;
};

export const PERSONAS: Record<PersonaName, PersonaPreset> = {
    amira: {
        name: 'amira',
        displayName: 'Amira',
        age: 26,
        capitalCad: 10_000,
        horizonYears: { min: 15, max: 15 },
        description: {
            fr: 'Amira, 26 ans, ingénieure logicielle. Vise la croissance : IA, un peu de crypto, tout en restant diversifiée. Horizon de 15 ans.',
            en: 'Amira, 26, software engineer. Aims for growth: AI, some crypto, while staying diversified. 15-year horizon.',
        },
        expectedLevel: 'Intermediate',
        expectedRisk: 'High',
        // risk points: growth 1 + 5+ yrs 2 + buy_more 2 + high 2 = 7 -> High
        answers: {
            goal: 'find ideas',
            traded: true,
            experience: '1-5y',
            tools: ['limit_or_stop'],
            investingGoal: 'growth',
            echeance: '5+ yrs',
            drop20: 'buy_more',
            selfRating: 'high',
            markets: 'global',
            sectors: ['Information Technology'],
            niches: [],
            themes: ['AI'],
            brands: ['NVDA', 'GOOGL', 'SHOP.TO'],
            avoid: [],
            agentStyle: 'suggest',
        },
        weights: { QQQ: 25, NVDA: 8, GOOGL: 8, 'SHOP.TO': 4, BTC: 7, ETH: 3, 'XIU.TO': 15, SPY: 10, GLD: 8, 'XBB.TO': 12 },
    },
    mateo: {
        name: 'mateo',
        displayName: 'Mateo',
        age: 41,
        capitalCad: 10_000,
        horizonYears: { min: 8, max: 12 },
        description: {
            fr: 'Mateo, 41 ans. Cherche l’équilibre, privilégie l’ESG et évite les entreprises controversées. Horizon de 8 à 12 ans.',
            en: 'Mateo, 41. Looks for balance, favours ESG and avoids controversial companies. 8 to 12-year horizon.',
        },
        expectedLevel: 'Intermediate',
        expectedRisk: 'Medium',
        // risk points: growth 1 + 5+ yrs 2 + wait 1 + medium 1 = 5 -> Medium
        answers: {
            goal: 'track',
            traded: true,
            experience: '5+y',
            tools: [],
            investingGoal: 'growth',
            echeance: '5+ yrs',
            drop20: 'wait',
            selfRating: 'medium',
            markets: 'global',
            sectors: [],
            niches: [],
            themes: ['ESG', 'dividends'],
            brands: ['MSFT'],
            avoid: [],
            agentStyle: 'teach me',
        },
        weights: { ESGV: 30, 'XIU.TO': 12, MSFT: 6, JNJ: 6, PG: 5, 'FTS.TO': 5, 'XBB.TO': 17, AGG: 8, GLD: 5, 'ZST.TO': 6 },
    },
    robert: {
        name: 'robert',
        displayName: 'Robert',
        age: 59,
        capitalCad: 10_000,
        horizonYears: { min: 3, max: 5 },
        description: {
            fr: 'Robert, 59 ans. Veut préserver son capital, très peu de crypto, mais tenté par une action très médiatisée. Horizon de 3 à 5 ans.',
            en: 'Robert, 59. Wants to preserve his capital, very little crypto, but tempted by a hyped stock. 3 to 5-year horizon.',
        },
        expectedLevel: 'Novice',
        expectedRisk: 'Low',
        // risk points: income 0 + 1 yr 1 (closest bucket to 3-5 years below "5+ yrs") + sell 0 + low 0 = 1 -> Low
        answers: {
            goal: 'track',
            traded: false,
            investingGoal: 'income',
            echeance: '1 yr',
            drop20: 'sell',
            selfRating: 'low',
            markets: 'Canada',
            sectors: [],
            niches: [],
            themes: ['dividends'],
            brands: ['RY.TO'],
            avoid: [],
            agentStyle: 'teach me',
        },
        weights: { 'XBB.TO': 22, 'ZST.TO': 18, AGG: 8, 'XIU.TO': 15, 'RY.TO': 6, JNJ: 6, PG: 6, 'FTS.TO': 6, GLD: 5, SPY: 8 },
    },
    novice: {
        name: 'novice',
        displayName: 'Demo novice',
        age: 23,
        // Half of the 10 000 $ simulated starting cash is placed; the rest stays in cash
        capitalCad: 5_000,
        horizonYears: { min: 10, max: 10 },
        description: {
            fr: 'Profil de démonstration : n’a jamais placé d’argent, veut apprendre. Quelques FNB indiciels larges et de l’encaisse. Horizon de 10 ans.',
            en: 'Demo profile: has never invested, wants to learn. A few broad index ETFs and some cash. 10-year horizon.',
        },
        expectedLevel: 'Novice',
        expectedRisk: 'Medium',
        // level: never traded -> Novice
        // risk points: growth 1 + 5+ yrs 2 + wait 1 + low 0 = 4 -> Medium
        answers: {
            goal: 'learn',
            traded: false,
            investingGoal: 'growth',
            echeance: '5+ yrs',
            drop20: 'wait',
            selfRating: 'low',
            markets: 'Canada',
            sectors: [],
            niches: [],
            themes: [],
            brands: [],
            avoid: [],
            agentStyle: 'teach me',
        },
        weights: { 'XIC.TO': 45, 'VFV.TO': 40, 'ZST.TO': 15 },
    },
    expert: {
        name: 'expert',
        displayName: 'Demo expert',
        age: 45,
        // The simulated portfolio always starts from 10 000 $ of cash (rules/v1.json simulated_portfolio.starting_cash)
        capitalCad: 10_000,
        horizonYears: { min: 5, max: 10 },
        description: {
            fr: 'Profil de démonstration : investisseur aguerri (ordres à cours limité, options, marge), veut des données brutes. Actions américaines et canadiennes, un FNB et du bitcoin.',
            en: 'Demo profile: seasoned investor (limit orders, options, margin), wants the raw data. US and Canadian stocks, one ETF and bitcoin.',
        },
        expectedLevel: 'Expert',
        expectedRisk: 'High',
        // level points: 5+y 2 + limit_or_stop 1 + options 1 + margin_or_shorting 1 = 5 -> Expert
        // risk points: growth 1 + 5+ yrs 2 + buy_more 2 + high 2 = 7 -> High
        answers: {
            goal: 'find ideas',
            traded: true,
            experience: '5+y',
            tools: ['limit_or_stop', 'options', 'margin_or_shorting'],
            investingGoal: 'growth',
            echeance: '5+ yrs',
            drop20: 'buy_more',
            selfRating: 'high',
            markets: 'global',
            sectors: ['Information Technology', 'Financials'],
            niches: [],
            themes: ['AI'],
            brands: ['NVDA', 'MSFT', 'SHOP.TO', 'CSU.TO'],
            avoid: [],
            agentStyle: 'just the data',
        },
        weights: {
            NVDA: 12, MSFT: 10, AMZN: 9, GOOGL: 8, JPM: 7,
            'SHOP.TO': 9, 'CSU.TO': 8, 'RY.TO': 8, 'CNR.TO': 7,
            QQQ: 12, BTC: 10,
        },
    },
};

export const isPersonaName = (value: unknown): value is PersonaName => typeof value === 'string' && Object.hasOwn(PERSONAS, value);

// Other addresses that lead to a persona (/u/demo-novice...)
export const PERSONA_ALIASES: Record<string, PersonaName> = {
    'demo-novice': 'novice',
    'demo-expert': 'expert',
};

/** The persona an address names (its own name or an alias), or null. */
export const personaOfAddress = (value: string): PersonaName | null =>
    isPersonaName(value) ? value : Object.hasOwn(PERSONA_ALIASES, value) ? PERSONA_ALIASES[value] : null;
