import { NextRequest } from 'next/server';
import { z } from 'zod';
import { respond } from '@/lib/services/http';
import { editProfile, getProfile, saveOnboarding } from '@/lib/services/profile';

export const dynamic = 'force-dynamic';

const text = z.string().trim().min(1).max(80);
const list = z.array(text).max(60);
const answerFields = {
    goal: z.enum(['learn', 'track', 'find ideas']),
    traded: z.boolean(),
    experience: z.enum(['<1y', '1-5y', '5+y']).optional(),
    tools: z.array(z.enum(['limit_or_stop', 'options', 'margin_or_shorting'])).max(3).optional(),
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
};
// A skipped interests question means "no preference": an empty list
const answersSchema = z.object({ ...answerFields, sectors: list.default([]), niches: list.default([]), themes: list.default([]), brands: list.default([]), avoid: list.default([]) }).strict();

// No defaults here: an edit changes only the fields it names
const patchSchema = z.object({
    level: z.enum(['Novice', 'Intermediate', 'Expert']).nullable().optional(),
    risk: z.enum(['Low', 'Medium', 'High']).nullable().optional(),
    answers: z.object(answerFields).partial().strict().optional(),
}).strict();

export const GET = () => respond(async () => ({ profile: await getProfile() }));

export const POST = (req: NextRequest) => respond(async () => {
    const { answers } = z.object({ answers: answersSchema }).parse(await req.json());
    // Someone who has not traded was not asked about experience or tools
    if (!answers.traded) {
        delete answers.experience;
        delete answers.tools;
    }
    return { profile: await saveOnboarding(answers) };
});

export const PATCH = (req: NextRequest) => respond(async () => {
    const patch = patchSchema.parse(await req.json());
    const given = Object.fromEntries(Object.entries(patch.answers ?? {}).filter(([, value]) => value !== undefined));
    return editProfile({ level: patch.level, risk: patch.risk, answers: given });
});
