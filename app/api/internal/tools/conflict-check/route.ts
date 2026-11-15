import { z } from 'zod';
import { internalTool } from '@/lib/agent/internal';
import { RULES } from '@/lib/rules';
import { ServiceError } from '@/lib/services/errors';
import { getProfile } from '@/lib/services/profile';
import { signalsFor } from '@/lib/services/quotes';
import { appendDecision } from '@/lib/store';
import { getEntry } from '@/lib/universe';
import { checkProfileConflict } from '@/lib/watchlist/conflict';

// The profile-conflict check for one asset: the profile's own filters, with the actual values. A conflict found
// while the user asks about an asset is logged, like one found on a simulated purchase.
export const POST = internalTool(z.object({ symbol: z.string().trim().min(1).max(20) }), async ({ symbol }, actionId) => {
    const entry = getEntry(symbol);
    if (!entry) throw new ServiceError(404, `${symbol} is not in the app's list of assets.`);
    const profile = await getProfile();
    if (!profile) throw new ServiceError(409, 'No profile exists yet. Complete onboarding first.');
    const { signals, fxUsdCad } = await signalsFor(entry);
    const { conflicts } = checkProfileConflict(signals, profile, RULES, fxUsdCad);
    if (conflicts.length > 0) {
        await appendDecision({
            userId: profile.userId,
            kind: 'profile_conflict',
            symbol: entry.symbol,
            ruleVersions: { filters: RULES.filters.version, level: profile.ruleVersions.level, risk: profile.ruleVersions.risk },
            payload: { conflicts, level: profile.level, risk: profile.risk, origin: 'agent', actionId, context: 'question', proceeded: false, signals, simulated: true },
        });
    }
    return { symbol: entry.symbol, conflicts, signals, level: profile.level, risk: profile.risk };
});
