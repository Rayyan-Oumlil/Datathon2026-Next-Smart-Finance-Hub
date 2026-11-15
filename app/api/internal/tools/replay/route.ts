import { z } from 'zod';
import { internalTool } from '@/lib/agent/internal';
import { StrategyRefusal, currentWeights, validateStrategy } from '@/lib/agent/strategy-propose';
import { PERSONAS, isPersonaName } from '@/lib/personas';
import { replayDigest, runReplay } from '@/lib/services/replay';
import { StrategyInvalidError } from '@/lib/services/rules-engine';

const DEFAULT_START = '2021-01-04';
const weights = z.array(z.strictObject({ symbol: z.string().trim().min(1).max(20), weightPct: z.number().positive().max(100) })).min(1).max(40);

const schema = z.object({
    /** 'current' (the simulated portfolio as it stands), explicit weights, or an example profile's starting weights. */
    portfolio: z.union([z.literal('current'), weights, z.string().trim().toLowerCase().refine(isPersonaName, 'not an example profile')]).default('current'),
    /** A strategy (name + rules), the id of a stored one, or null for no rule (both series are then identical). */
    strategy: z.union([z.string().trim().min(1).max(40), z.record(z.string(), z.unknown()), z.null()]).default(null),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default(DEFAULT_START),
    feePerOrderCad: z.number().min(0).max(100).default(0),
    locale: z.enum(['en', 'fr']).default('en'),
});

// Field names the reply must not echo: the agent writes "largest fall" / "repli maximal", never a judgement word
const RENAMES: Array<[RegExp, string]> = [[/"worstFall/g, '"largestFall'], [/"worstDay"/g, '"largestDailyFall"']];
const forAgent = (digest: unknown) => JSON.parse(RENAMES.reduce((text, [from, to]) => text.replace(from, to), JSON.stringify(digest)));

// The time machine for the agent: the same replay as the page (lib/services/replay), returned as its compact digest
// (no daily series, no journal) in the request's language, plus the replay id. Read-only; the run is logged.
export const POST = internalTool(schema, async ({ portfolio, strategy, startDate, feePerOrderCad, locale }, _actionId, scope) => {
    let capitalCad = 10_000;
    let start: 'current' | Array<{ symbol: string; weightPct: number }>;
    let portfolioLabel: string;
    if (portfolio === 'current') {
        start = 'current';
        capitalCad = Math.max(100, (await currentWeights(scope)).valueCad);
        portfolioLabel = 'current simulated portfolio';
    } else if (typeof portfolio === 'string') {
        const persona = PERSONAS[portfolio as keyof typeof PERSONAS];
        start = Object.entries(persona.weights).map(([symbol, weightPct]) => ({ symbol, weightPct }));
        capitalCad = persona.capitalCad;
        portfolioLabel = `example profile ${persona.displayName}`;
    } else {
        start = portfolio;
        portfolioLabel = 'weights given';
    }
    let given: string | Record<string, unknown> | null = strategy;
    try {
        if (given && typeof given === 'object') given = validateStrategy(given, locale) as unknown as Record<string, unknown>;
        const result = await runReplay({ portfolio: start, capitalCad, strategy: given, startDate, feePerOrderCad }, { scope });
        const { summary, ...digest } = replayDigest(result, locale);
        const { endedHigher: _hidden, ...facts } = summary;
        return forAgent({
            portfolio: portfolioLabel, capitalCad: result.params.capitalCad, ...digest, summary: facts,
            note: 'Illustrative replay on historical data, not a prediction. Both series use the same capital, fees and data. State both series; name no winner.',
        });
    } catch (error) {
        if (error instanceof StrategyRefusal) return { error: error.messages.join(' '), issues: error.issues };
        if (error instanceof StrategyInvalidError) return { error: error.messageIn(locale), issues: error.issues.map(({ code, path, values }) => ({ code, path, values })) };
        throw error;
    }
});
