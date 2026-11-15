import type { FilterCheck, SignalSet, Sourced } from '@/lib/domain/types';
import { noviceStockFloorUsd, type Rules } from '@/lib/rules';
import { normalize, numberOf, type ProfileView } from '@/lib/watchlist/format';
import { say, type Locale, type WatchlistParams, type WatchlistTextKey } from '@/lib/watchlist/text';

type Context = { signals: SignalSet; profile: ProfileView; rules: Rules; fx?: Sourced; locale: Locale };
type Missing = WatchlistParams<'filter.data.missing'>['what'];
type NeededFor = WatchlistParams<'filter.data.missing'>['neededFor'];

/** One check, its detail rendered in the language and the catalog key with the values kept beside it. */
function check<K extends WatchlistTextKey>(
    filter: FilterCheck['filter'],
    pass: boolean,
    key: K,
    params: WatchlistParams<K>,
    locale: Locale,
    numbers: { value?: number; limit?: number } = {},
): FilterCheck {
    const { text, textRef } = say(key, params, locale);
    return { filter, pass, ...numbers, detail: text, textRef };
}

/** A USD amount, converting from CAD with the snapshot's USD/CAD rate (CAD per 1 USD) when the value is still in CAD. */
function inUsd(sourced: Sourced | undefined, fx: Sourced | undefined, what: Missing, neededFor: NeededFor, locale: Locale): { usd: number } | { check: FilterCheck } {
    const value = numberOf(sourced);
    if (value === undefined) return { check: check('data', false, 'filter.data.missing', { what, neededFor }, locale) };
    if (sourced?.currency !== 'CAD') return { usd: value };
    const rate = numberOf(fx);
    if (rate === undefined || rate <= 0) {
        return { check: check('data', false, 'filter.data.fx_missing', { what, neededFor }, locale) };
    }
    return { usd: value / rate };
}

function avoidList({ signals, profile, locale }: Context): FilterCheck[] {
    const { entry } = signals;
    const avoid = new Set(profile.answers.avoid.map(normalize));
    if (avoid.has(normalize(entry.symbol))) {
        return [check('avoid_list', false, 'filter.avoid.symbol', { symbol: entry.symbol }, locale)];
    }
    if (entry.sector !== undefined && avoid.has(normalize(entry.sector))) {
        return [check('avoid_list', false, 'filter.avoid.sector', { symbol: entry.symbol, sector: entry.sector }, locale)];
    }
    return [check('avoid_list', true, 'filter.avoid.clear', { symbol: entry.symbol, sector: entry.sector ?? null }, locale)];
}

function markets({ signals, profile, locale }: Context): FilterCheck[] {
    const { market, symbol } = signals.entry;
    const picked = profile.answers.markets;
    if (market === 'none') {
        return [check('markets', false, 'filter.markets.none', { symbol, picked }, locale)];
    }
    const pass = picked === 'global' || picked === market;
    return [check('markets', pass, 'filter.markets.listed', { symbol, market, picked }, locale)];
}

function volatility({ signals, profile, rules, locale }: Context): FilterCheck[] {
    const value = numberOf(signals.volatility1y);
    if (value === undefined) return [check('data', false, 'filter.data.missing', { what: 'volatility_1y', neededFor: 'volatility_cap' }, locale)];
    // A standard deviation cannot be negative: such a value is a provider or computation fault, not a low volatility.
    if (value < 0) return [check('data', false, 'filter.data.volatility_negative', { value }, locale)];
    const limit = rules.filters.volatility.cap_by_risk[profile.risk];
    const pass = value <= limit;
    return [check('volatility', pass, 'filter.volatility', { value, limit, pass, risk: profile.risk }, locale, { value, limit })];
}

function marketCapFloor({ signals, profile, rules, fx, locale }: Context): FilterCheck[] {
    const cap = inUsd(signals.marketCapUsd, fx, 'market_cap', 'market_cap_floor', locale);
    if ('check' in cap) return [cap.check];
    const limit = rules.filters.market_cap_floor_usd.by_risk[profile.risk];
    const pass = cap.usd >= limit;
    return [check('market_cap_floor', pass, 'filter.market_cap_floor', { value: cap.usd, limit, pass, risk: profile.risk }, locale, { value: cap.usd, limit })];
}

function liquidity({ signals, rules, fx, locale }: Context): FilterCheck[] {
    const traded = inUsd(signals.avgDailyTradedValueUsd, fx, 'avg_traded_value', 'liquidity_minimum', locale);
    if ('check' in traded) return [traded.check];
    const limit = rules.filters.liquidity.min_usd_per_day;
    const pass = traded.usd >= limit;
    return [check('liquidity', pass, 'filter.liquidity', { value: traded.usd, limit, pass }, locale, { value: traded.usd, limit })];
}

function esg({ signals, profile, locale }: Context): FilterCheck[] {
    const tag = signals.entry.esg;
    if (!profile.answers.themes.some((theme) => normalize(theme) === 'esg')) {
        return [check('esg', true, 'filter.esg.not_picked', { tag }, locale)];
    }
    return [check('esg', tag === 'screened', 'filter.esg.picked', { tag }, locale)];
}

// The names used in rules.filters.asset_class_rules.*.filters.
const BASE_FILTERS: Record<string, (context: Context) => FilterCheck[]> = {
    avoid_list: avoidList,
    markets,
    volatility,
    market_cap_floor: marketCapFloor,
    liquidity,
    esg,
};

function noviceStock({ signals, rules, fx, locale }: Context): FilterCheck[] {
    const cap = inUsd(signals.marketCapUsd, fx, 'market_cap', 'market_cap_floor', locale);
    if ('check' in cap) return []; // already reported by the market-cap floor
    const limit = noviceStockFloorUsd(rules);
    const pass = cap.usd >= limit;
    return [check('novice', pass, 'filter.novice.stock', { value: cap.usd, limit, pass }, locale, { value: cap.usd, limit })];
}

function blueChipEtf(filter: 'novice' | 'low_risk_etf', { signals, locale }: Context): FilterCheck {
    const { symbol, blueChipEtf: onList } = signals.entry;
    return check(filter, onList === true, 'filter.blue_chip_etf', { symbol, onList: onList === true, who: filter === 'novice' ? 'novice' : 'low_risk' }, locale);
}

/**
 * Stage B. Every filter that applies to the asset class is run and reported (pass or fail), so the "Why?" panel
 * and the conflict check can show all of them with the actual numbers. The candidate passes when every check passes.
 * A value a filter needs but the snapshot does not have fails the candidate with filter 'data'; no value is assumed.
 * The details are written in `locale` (default English); which checks run and their results never depend on it.
 */
export function runFilters(signals: SignalSet, profile: ProfileView, rules: Rules, fx?: Sourced, locale: Locale = 'en'): FilterCheck[] {
    const context: Context = { signals, profile, rules, fx, locale };
    const classRules = rules.filters.asset_class_rules;
    const assetClass = signals.entry.assetClass;
    const isNovice = profile.level === 'Novice';

    const names = { stock: classRules.stock, etf: classRules.etf, crypto: classRules.crypto, gold: classRules.gold, bond_yield: classRules.bond_yields }[assetClass].filters;
    const checks = names.flatMap((name) => {
        const run = BASE_FILTERS[name];
        if (!run) throw new Error(`filters ${rules.filters.version}: unknown filter "${name}" for ${assetClass}`);
        return run(context);
    });

    if (assetClass === 'stock' && isNovice) checks.push(...noviceStock(context));

    if (assetClass === 'etf') {
        if (isNovice) checks.push(blueChipEtf('novice', context));
        if (profile.risk === 'Low') checks.push(blueChipEtf('low_risk_etf', context));
    }

    if (assetClass === 'crypto') {
        const { assets, allowed_risk: allowedRisk } = classRules.crypto;
        const symbol = signals.entry.symbol;
        if (!assets.includes(symbol)) {
            checks.push(check('crypto_risk', false, 'filter.crypto.not_listed', { symbol, assets: [...assets] }, locale));
        }
        checks.push(check('crypto_risk', allowedRisk.includes(profile.risk), 'filter.crypto.risk', { allowed: [...allowedRisk], risk: profile.risk }, locale));
        if (isNovice) checks.push(check('novice', false, 'filter.crypto.novice', {}, locale));
    }

    return checks;
}
