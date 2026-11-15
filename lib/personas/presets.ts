// The three stored example users (brief B7). Data only; lib/personas/index.ts seeds them through the normal
// profile and trade services. Level and risk are never given here: the onboarding answers below are scored by
// rules/v1.json like anyone else's (risk points: goal + échéance + 20 % drop + self-rating, bands 0-2 / 3-5 / 6-8).
// If an answer stops giving the expected risk, change the answer here, never the rule (__tests__/personas).

import type { OnboardingAnswers, Risk } from '@/lib/domain/types';

export type PersonaName = 'amira' | 'mateo' | 'robert';

export type PersonaPreset = {
    name: PersonaName;
    displayName: string;
    age: number;
    capitalCad: number;
    // The real horizon in years; onboarding only offers coarse buckets, so the answer is the closest one
    horizonYears: { min: number; max: number };
    description: { fr: string; en: string };
    expectedRisk: Risk;       // what the answers must compute to (checked by the persona tests, never forced)
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
};

export const isPersonaName = (value: unknown): value is PersonaName => typeof value === 'string' && Object.hasOwn(PERSONAS, value);
