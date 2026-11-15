// The shape of a profile change coming from the agent: { level?, risk?, sectors?, ... }, checked field by field.

import { z } from 'zod';
import type { ProfilePatch } from '@/lib/services/profile';

const text = z.string().trim().min(1).max(80);
const list = z.array(text).max(60);
const answers = z.object({
    goal: z.enum(['learn', 'track', 'find ideas']),
    traded: z.boolean(),
    experience: z.enum(['<1y', '1-5y', '5+y']),
    tools: z.array(z.enum(['limit_or_stop', 'options', 'margin_or_shorting'])).max(3),
    investingGoal: z.enum(['income', 'growth', 'trading']),
    echeance: z.enum(['weeks', 'months', '1 yr', '5+ yrs']),
    drop20: z.enum(['sell', 'wait', 'buy_more']),
    selfRating: z.enum(['low', 'medium', 'high']),
    markets: z.enum(['US', 'Canada', 'global']),
    sectors: list,
    niches: list,
    themes: list,
    brands: list,
    avoid: list,
    agentStyle: z.enum(['teach me', 'suggest', 'just the data']),
}).partial().strict();

export const profileChangesSchema = answers.extend({
    level: z.enum(['Novice', 'Intermediate', 'Expert']).nullable().optional(),
    risk: z.enum(['Low', 'Medium', 'High']).nullable().optional(),
    answers: answers.optional(),        // the same fields, nested: both spellings are accepted
}).strict();
export type ProfileChanges = z.infer<typeof profileChangesSchema>;

export function toProfilePatch(changes: ProfileChanges): ProfilePatch {
    const { level, risk, answers: nested, ...flat } = changes;
    const given = Object.fromEntries(Object.entries({ ...nested, ...flat }).filter(([, value]) => value !== undefined));
    return { ...(level !== undefined ? { level } : {}), ...(risk !== undefined ? { risk } : {}), answers: given };
}
