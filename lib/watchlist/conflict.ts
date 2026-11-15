import type { FilterCheck, SignalSet, Sourced } from '@/lib/domain/types';
import type { Rules } from '@/lib/rules';
import { runFilters } from '@/lib/watchlist/filters';
import type { ProfileView } from '@/lib/watchlist/format';
import type { Locale } from '@/lib/watchlist/text';

/**
 * The profile-conflict check for one asset: the filters it fails for this profile, each with the actual values.
 * It uses the profile's own filter values; no extra threshold exists. An empty list means no conflict.
 * The details are written in `locale` (default English).
 */
export function checkProfileConflict(signals: SignalSet, profile: ProfileView, rules: Rules, fx?: Sourced, locale: Locale = 'en'): { conflicts: FilterCheck[] } {
    return { conflicts: runFilters(signals, profile, rules, fx, locale).filter((check) => !check.pass) };
}
