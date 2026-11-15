// The profile-conflict check applied to a strategy (brief B5). Deterministic: no model takes part.
//
// 1. Every symbol a rule could acquire goes through the existing per-asset check (lib/watchlist/conflict.ts, the
//    profile's own filters with their actual values):
//    - allocation targets that are new to the simulated portfolio, or whose target weight is above the holding's
//      current weight by more than ACQUIRE_MARGIN_PTS (a holding the rule only keeps or trims is not checked again:
//      it is already in the portfolio);
//    - the drawdown guard's defensive symbol, the weight cap's proceeds symbol, a price-threshold rule that adds.
// 2. Two strategy-level notes:
//    - HIGH_VOL_SHARE_MAX_PCT: when more than this share of an allocation target's weights sits in assets whose
//      1-year volatility is above the profile's volatility cap (rules/v1.json filters.volatility.cap_by_risk), it is
//      flagged with the share, the threshold and the cap. 10 % is this app's own threshold (agreed for the demo,
//      2026-11-15), not a regulatory figure;
//    - crypto in a profile other than High (rules/v1.json filters.asset_class_rules.crypto.allowed_risk), when the
//      per-asset check did not already say so.
// The conflicts never block: the user may still confirm in simulation. Both the conflict and the decision are logged
// with kind 'profile_conflict' by the router.

import type { Locale } from '@/i18n/config';
import type { FilterCheck, ProfileConfig, Sourced } from '@/lib/domain/types';
import { RULES } from '@/lib/rules';
import { signalsFor } from '@/lib/services/quotes';
import { targetSymbols, type Strategy } from '@/lib/strategy/types';
import { getEntry } from '@/lib/universe';
import { checkProfileConflict } from '@/lib/watchlist/conflict';
import { riskName, strategyWords } from './strategy-words';

export const HIGH_VOL_SHARE_MAX_PCT = 10;
export const ACQUIRE_MARGIN_PTS = 0.5;

/** A conflict with the symbol it is about ('strategy' for a strategy-level note). */
export type StrategyConflict = FilterCheck & { symbol: string };
export type StrategyConflictReport = {
    conflicts: StrategyConflict[];
    /** Symbols checked through the per-asset check. */
    checked: string[];
    /** Symbols a rule could acquire that are not in the app's list of assets: no profile check exists for them. */
    unchecked: string[];
    /** The values behind the volatility figures, for the log. */
    signals: Record<string, { volatility1y?: Sourced }>;
};

/** The symbols a strategy could add to, given the current weights in percent of the portfolio. */
export function acquirableSymbols(strategy: Pick<Strategy, 'rules'>, currentWeights: Record<string, number>): string[] {
    const found = new Set<string>();
    for (const rule of strategy.rules) {
        if (rule.kind === 'allocation_target') {
            for (const target of rule.targets) {
                const symbols = 'symbol' in target ? [target.symbol] : target.symbols;
                const share = target.weightPct / symbols.length;
                for (const symbol of symbols) if (share > (currentWeights[symbol] ?? 0) + ACQUIRE_MARGIN_PTS) found.add(symbol);
            }
        } else if (rule.kind === 'drawdown_guard') found.add(rule.defensiveSymbol);
        else if (rule.kind === 'weight_cap' && rule.proceedsSymbol) found.add(rule.proceedsSymbol);
        else if (rule.kind === 'price_threshold' && rule.action.side === 'buy') found.add(rule.symbol);
    }
    return [...found].sort();
}

/** The strategy against the profile. `currentWeights`: the simulated portfolio's weights in percent, by symbol. */
export async function checkStrategyConflicts(strategy: Pick<Strategy, 'rules'>, profile: Pick<ProfileConfig, 'level' | 'risk' | 'answers'>, currentWeights: Record<string, number>, locale: Locale): Promise<StrategyConflictReport> {
    const words = strategyWords(locale);
    const acquire = acquirableSymbols(strategy, currentWeights);
    const allTargets = [...new Set(strategy.rules.flatMap((rule) => (rule.kind === 'allocation_target' ? targetSymbols(rule.targets) : [])))];
    const wanted = [...new Set([...acquire, ...allTargets])];
    const entries = new Map(wanted.map((symbol) => [symbol, getEntry(symbol)] as const));
    const known = [...entries.values()].filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
    const unique = [...new Map(known.map((e) => [e.symbol, e])).values()];
    const loaded = await Promise.all(unique.map((entry) => signalsFor(entry).catch(() => null)));
    const bySymbol = new Map(unique.map((entry, i) => [entry.symbol, loaded[i]] as const));
    const fxUsdCad = loaded.find((item) => item?.fxUsdCad)?.fxUsdCad;
    const signalOf = (symbol: string) => {
        const entry = entries.get(symbol);
        return entry ? bySymbol.get(entry.symbol)?.signals : undefined;
    };

    const conflicts: StrategyConflict[] = [];
    const checked: string[] = [];
    const unchecked: string[] = [];
    const signals: StrategyConflictReport['signals'] = {};
    for (const symbol of acquire) {
        const set = signalOf(symbol);
        if (!set) {
            unchecked.push(symbol);
            continue;
        }
        checked.push(symbol);
        signals[symbol] = { volatility1y: set.volatility1y };
        for (const check of checkProfileConflict(set, profile, RULES, fxUsdCad, locale).conflicts) {
            conflicts.push({ ...check, symbol, detail: words.prefixed(symbol, check.detail) });
        }
        if (set.entry.assetClass === 'crypto' && profile.risk !== 'High' && !conflicts.some((c) => c.symbol === symbol && c.filter === 'crypto_risk')) {
            conflicts.push({ symbol, filter: 'crypto_risk', pass: false, detail: words.cryptoRisk(symbol, riskName(profile.risk, locale)) });
        }
    }

    // The share of each allocation target in assets above the profile's volatility cap
    const cap = RULES.filters.volatility.cap_by_risk[profile.risk];
    for (const rule of strategy.rules) {
        if (rule.kind !== 'allocation_target') continue;
        let share = 0;
        const over: string[] = [];
        for (const target of rule.targets) {
            const symbols = 'symbol' in target ? [target.symbol] : target.symbols;
            for (const symbol of symbols) {
                const vol = signalOf(symbol)?.volatility1y?.value;
                if (typeof vol === 'number' && vol > cap) {
                    share += target.weightPct / symbols.length;
                    over.push(symbol);
                    signals[symbol] = { volatility1y: signalOf(symbol)?.volatility1y };
                }
            }
        }
        share = Math.round(share * 100) / 100;
        if (share > HIGH_VOL_SHARE_MAX_PCT) {
            conflicts.push({
                symbol: 'strategy', filter: 'volatility', pass: false, value: share, limit: HIGH_VOL_SHARE_MAX_PCT,
                detail: words.highVolShare(share, HIGH_VOL_SHARE_MAX_PCT, cap * 100, riskName(profile.risk, locale), over),
            });
        }
    }
    return { conflicts, checked, unchecked: unchecked.sort(), signals };
}
