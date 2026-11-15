import type { FilterCheck, SignalSet, Sourced } from '@/lib/domain/types';
import type { Rules } from '@/lib/rules';
import { runFilters } from '@/lib/watchlist/filters';
import type { ProfileView } from '@/lib/watchlist/format';

/**
 * The profile-conflict check for one asset: the filters it fails for this profile, each with the actual values.
 * It uses the profile's own filter values; no extra threshold exists. An empty list means no conflict.
 */
export function checkProfileConflict(signals: SignalSet, profile: ProfileView, rules: Rules, fx?: Sourced): { conflicts: FilterCheck[] } {
    return { conflicts: runFilters(signals, profile, rules, fx).filter((check) => !check.pass) };
}
