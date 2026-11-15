import { z } from 'zod';
import type { FilterCheck, Sourced } from '@/lib/domain/types';
import { internalTool } from '@/lib/agent/internal';
import { RULES } from '@/lib/rules';
import { ServiceError } from '@/lib/services/errors';
import { getProfile } from '@/lib/services/profile';
import { signalsFor } from '@/lib/services/quotes';
import { appendDecision } from '@/lib/store';
import { getEntry } from '@/lib/universe';
import { checkProfileConflict } from '@/lib/watchlist/conflict';

// The signal each numeric filter reads. Only these values are returned, so the agent can cite their source and time.
const SIGNAL_OF: Partial<Record<FilterCheck['filter'], 'volatility1y' | 'marketCapUsd' | 'avgDailyTradedValueUsd'>> = {
    volatility: 'volatility1y', market_cap_floor: 'marketCapUsd', novice: 'marketCapUsd', liquidity: 'avgDailyTradedValueUsd',
};

// The profile-conflict check for one asset: the profile's own filters, with the actual values. A conflict found
// while the user asks about an asset is logged, like one found on a simulated purchase. Each detail is written in
// `locale` (the agent passes its request's), English when it is left out; the textRef renders it in either language.
export const POST = internalTool(z.object({ symbol: z.string().trim().min(1).max(20), locale: z.enum(['en', 'fr']).optional() }), async ({ symbol, locale }, actionId) => {
    const entry = getEntry(symbol);
    if (!entry) throw new ServiceError(404, `${symbol} is not in the app's list of assets.`);
    const profile = await getProfile();
    if (!profile) throw new ServiceError(409, 'No profile exists yet. Complete onboarding first.');
    const { signals, fxUsdCad } = await signalsFor(entry);
    const { conflicts } = checkProfileConflict(signals, profile, RULES, fxUsdCad, locale ?? 'en');
    if (conflicts.length > 0) {
        await appendDecision({
            userId: profile.userId,
            kind: 'profile_conflict',
            symbol: entry.symbol,
            ruleVersions: { filters: RULES.filters.version, level: profile.ruleVersions.level, risk: profile.ruleVersions.risk },
            payload: { conflicts, level: profile.level, risk: profile.risk, origin: 'agent', actionId, context: 'question', proceeded: false, signals, simulated: true },
        });
    }
    // The full signal set stays in the decision log; the agent gets only the values behind each conflict.
    const sources: Record<string, Sourced> = {};
    for (const check of conflicts) {
        const key = check.value === undefined ? undefined : SIGNAL_OF[check.filter];
        const value = key ? signals[key] : undefined;
        if (key && value) sources[key] = value;
    }
    // A value in CAD was converted with the rate before the check, so the rate is one of its inputs
    if (fxUsdCad && Object.values(sources).some((value) => value.currency === 'CAD')) sources.fxUsdCad = fxUsdCad;
    return { symbol: entry.symbol, conflicts, sources, level: profile.level, risk: profile.risk };
});
