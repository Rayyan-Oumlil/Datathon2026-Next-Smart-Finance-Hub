import type { FilterCheck, SignalSet, Sourced } from '@/lib/domain/types';
import { noviceStockFloorUsd, type Rules } from '@/lib/rules';
import { formatPercent, formatPercentPair, formatUsdPair, normalize, numberOf, type ProfileView } from '@/lib/watchlist/format';

type Context = { signals: SignalSet; profile: ProfileView; rules: Rules; fx?: Sourced };

const missing = (detail: string): FilterCheck => ({ filter: 'data', pass: false, detail });

/** A USD amount, converting from CAD with the snapshot's USD/CAD rate (CAD per 1 USD) when the value is still in CAD. */
function inUsd(sourced: Sourced | undefined, fx: Sourced | undefined, label: string, neededFor: string): { usd: number } | { check: FilterCheck } {
    const value = numberOf(sourced);
    if (value === undefined) return { check: missing(`${label} is missing, so the ${neededFor} cannot be checked`) };
    if (sourced?.currency !== 'CAD') return { usd: value };
    const rate = numberOf(fx);
    if (rate === undefined || rate <= 0) {
        return { check: missing(`USD/CAD rate is missing, so the ${label} in CAD cannot be converted for the ${neededFor}`) };
    }
    return { usd: value / rate };
}

function avoidList({ signals, profile }: Context): FilterCheck[] {
    const { entry } = signals;
    const avoid = new Set(profile.answers.avoid.map(normalize));
    if (avoid.has(normalize(entry.symbol))) {
        return [{ filter: 'avoid_list', pass: false, detail: `${entry.symbol} is on the avoid list` }];
    }
    if (entry.sector !== undefined && avoid.has(normalize(entry.sector))) {
        return [{ filter: 'avoid_list', pass: false, detail: `${entry.symbol} is in ${entry.sector}, a sector on the avoid list` }];
    }
    const what = entry.sector !== undefined ? `${entry.symbol} and its sector ${entry.sector} are` : `${entry.symbol} is`;
    return [{ filter: 'avoid_list', pass: true, detail: `${what} not on the avoid list` }];
}

function markets({ signals, profile }: Context): FilterCheck[] {
    const { market, symbol } = signals.entry;
    const picked = profile.answers.markets;
    const pickedText = picked === 'global' ? 'global (US and Canada)' : picked;
    if (market === 'none') {
        return [{ filter: 'markets', pass: false, detail: `${symbol} has no listing market on file; markets picked: ${pickedText}` }];
    }
    const pass = picked === 'global' || picked === market;
    return [{ filter: 'markets', pass, detail: `${symbol} is listed in ${market}; markets picked: ${pickedText}` }];
}

function volatility({ signals, profile, rules }: Context): FilterCheck[] {
    const value = numberOf(signals.volatility1y);
    if (value === undefined) return [missing('1-year volatility is missing, so the volatility cap cannot be checked')];
    // A standard deviation cannot be negative: such a value is a provider or computation fault, not a low volatility.
    if (value < 0) return [missing(`1-year volatility ${formatPercent(value)} is negative, which is not a valid value, so the volatility cap cannot be checked`)];
    const limit = rules.filters.volatility.cap_by_risk[profile.risk];
    const pass = value <= limit;
    const [valueText, limitText] = formatPercentPair(value, limit);
    const verdict = pass ? (value === limit ? 'is at' : 'is within') : 'is above';
    return [{ filter: 'volatility', pass, value, limit, detail: `volatility ${valueText} ${verdict} the ${limitText} cap for ${profile.risk} risk` }];
}

function marketCapFloor({ signals, profile, rules, fx }: Context): FilterCheck[] {
    const cap = inUsd(signals.marketCapUsd, fx, 'market cap', 'market-cap floor');
    if ('check' in cap) return [cap.check];
    const limit = rules.filters.market_cap_floor_usd.by_risk[profile.risk];
    const pass = cap.usd >= limit;
    const [valueText, limitText] = formatUsdPair(cap.usd, limit);
    const verdict = pass ? (cap.usd === limit ? 'is at' : 'is above') : 'is below';
    return [{ filter: 'market_cap_floor', pass, value: cap.usd, limit, detail: `market cap ${valueText} ${verdict} the ${limitText} floor for ${profile.risk} risk` }];
}

function liquidity({ signals, rules, fx }: Context): FilterCheck[] {
    const traded = inUsd(signals.avgDailyTradedValueUsd, fx, 'average daily traded value', 'liquidity minimum');
    if ('check' in traded) return [traded.check];
    const limit = rules.filters.liquidity.min_usd_per_day;
    const pass = traded.usd >= limit;
    const [valueText, limitText] = formatUsdPair(traded.usd, limit);
    const verdict = pass ? (traded.usd === limit ? 'is at' : 'is above') : 'is below';
    return [{ filter: 'liquidity', pass, value: traded.usd, limit, detail: `average traded value ${valueText} a day ${verdict} the ${limitText} a day minimum` }];
}

function esg({ signals, profile }: Context): FilterCheck[] {
    const tag = signals.entry.esg;
    if (!profile.answers.themes.some((theme) => normalize(theme) === 'esg')) {
        return [{ filter: 'esg', pass: true, detail: `ESG theme not picked, so the ESG tag "${tag}" (demo data) is not checked` }];
    }
    const pass = tag === 'screened';
    return [{ filter: 'esg', pass, detail: `ESG theme picked: only "screened" passes; the ESG tag is "${tag}" (demo data)` }];
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

function noviceStock({ signals, rules, fx }: Context): FilterCheck[] {
    const cap = inUsd(signals.marketCapUsd, fx, 'market cap', 'market-cap floor');
    if ('check' in cap) return []; // already reported by the market-cap floor
    const limit = noviceStockFloorUsd(rules);
    const pass = cap.usd >= limit;
    const [valueText, limitText] = formatUsdPair(cap.usd, limit);
    const verdict = pass ? (cap.usd === limit ? 'is at' : 'is above') : 'is below';
    return [{ filter: 'novice', pass, value: cap.usd, limit, detail: `market cap ${valueText} ${verdict} the ${limitText} floor for Novice stocks` }];
}

function blueChipEtf(filter: 'novice' | 'low_risk_etf', who: string, { signals }: Context): FilterCheck {
    const { symbol, blueChipEtf: onList } = signals.entry;
    return onList === true
        ? { filter, pass: true, detail: `${symbol} is on the blue-chip ETF list; ${who} only gets blue-chip ETFs` }
        : { filter, pass: false, detail: `${symbol} is not on the blue-chip ETF list; ${who} only gets blue-chip ETFs` };
}

/**
 * Stage B. Every filter that applies to the asset class is run and reported (pass or fail), so the "Why?" panel
 * and the conflict check can show all of them with the actual numbers. The candidate passes when every check passes.
 * A value a filter needs but the snapshot does not have fails the candidate with filter 'data'; no value is assumed.
 */
export function runFilters(signals: SignalSet, profile: ProfileView, rules: Rules, fx?: Sourced): FilterCheck[] {
    const context: Context = { signals, profile, rules, fx };
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
        if (isNovice) checks.push(blueChipEtf('novice', 'a Novice', context));
        if (profile.risk === 'Low') checks.push(blueChipEtf('low_risk_etf', 'a Low risk profile', context));
    }

    if (assetClass === 'crypto') {
        const { assets, allowed_risk: allowedRisk } = classRules.crypto;
        const symbol = signals.entry.symbol;
        if (!assets.includes(symbol)) {
            checks.push({ filter: 'crypto_risk', pass: false, detail: `${symbol} is not one of the crypto assets listed (${assets.join(', ')})` });
        }
        checks.push({
            filter: 'crypto_risk',
            pass: allowedRisk.includes(profile.risk),
            detail: `crypto is listed for ${allowedRisk.join(' / ')} risk only; the profile's risk is ${profile.risk}`,
        });
        if (isNovice) checks.push({ filter: 'novice', pass: false, detail: 'crypto is never listed for a Novice' });
    }

    return checks;
}
