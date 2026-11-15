// The portfolio X-ray: loads the simulated holdings and their daily closes, hands them to the pure engine
// (lib/xray) and adds what only the app knows: the user's risk band and answer to the drop question. Read-only:
// nothing is written and no trade is placed, not even by the what-if.

import { getAppLocale } from '@/i18n/locale';
import type { FilterCheck, Position, ProfileConfig, Risk, Sourced } from '@/lib/domain/types';
import { RULES } from '@/lib/rules';
import type { DailyClose } from '@/lib/sources/types';
import { currentScope, type Scope } from '@/lib/session';
import { getProfile } from '@/lib/store';
import { getEntry } from '@/lib/universe';
import { checkProfileConflict } from '@/lib/watchlist/conflict';
import type { Locale } from '@/lib/watchlist/text';
import { computeComparison, computeEngine } from '@/lib/xray/engine';
import { XRAY_VERSION, type EngineHolding, type EngineInput, type EngineOutput } from '@/lib/xray/types';
import { createHash } from 'node:crypto';
import { createViewCache } from './cache';
import { ServiceError, round2 } from './errors';
import { getPortfolio, getPortfolioState } from './portfolio';
import { dailyClosesLongFor, fxUsdCadHistory, isTradable, liveQuote, signalsFor } from './quotes';
import { renderText, serviceRef } from './text';

export type XrayChange = { symbol: string; amountCad: number; direction: 'add' | 'reduce' };

export type XrayView = EngineOutput & {
    version: typeof XRAY_VERSION;
    simulated: true;
    computedAt: string;
    asOf: string | null;                                      // the last day of the longest replay
    band: { risk: Risk; volatilityLimitPct: number } | null;   // the watchlist's own limit for the user's risk profile
    dropAnswer: 'sell' | 'wait' | 'buy_more' | null;           // the user's answer to the 20 % drop question
    unpriced: string[];                                       // held symbols with no price now; not in the figures
    method: string;
    assumptions: string[];
    sources: Array<Sourced<string>>;
};

export type XrayWhatIf = { change: XrayChange; before: XrayView; after: XrayView; conflicts: FilterCheck[]; simulated: true };

const METHOD = `${XRAY_VERSION}: constant-weights replay: today's proportions applied to every past day, over daily closes in CAD `
    + '(a USD close is multiplied by the Bank of Canada USD/CAD rate of the day); calendar = the days every held stock and fund has a close; '
    + 'volatility = sample standard deviation of daily returns x sqrt(observations a year of the calendar used: about 252 for exchange days, about 365 when only crypto sets it, every day); '
    + 'a holding whose history does not reach over a period is left out of it, named, and the coverage is stated as a share of the value; '
    + 'what-if: before and after over the same dates and the same covered holdings, the window starting at the latest first close of the holdings of both; '
    + 'maximum drawdown = lowest value of (curve / running peak - 1); '
    + "risk share of a holding = weight x covariance(holding, portfolio) / variance(portfolio); effective holdings = 1 / sum of squared shares of the invested part; "
    + 'price changes only, dividends not included.';
const ASSUMPTIONS = [
    "Scenario: today's proportions are applied to every past day. It is not what the simulated portfolio earned.",
    'Price changes only: dividends, fees and taxes are not included.',
    'Returns are in Canadian dollars: a US close is converted at the Bank of Canada rate of its day.',
    "The volatility limit is the watchlist's own limit for the user's risk profile, not a regulatory threshold.",
    'Past behaviour does not predict future results.',
];

const groupOf = (position: Position) => position.sector ?? ({ etf: 'ETF', crypto: 'Crypto' } as Record<string, string>)[position.assetClass] ?? 'Other';
// The first January 1st at least five years back: the FX history is cached under this date, so it is fetched once a year
const fxStart = () => `${new Date().getUTCFullYear() - 5}-01-01`;

type Gathered = { input: EngineInput; unpriced: string[]; sources: Array<Sourced<string>>; profile: ProfileConfig | null };

function describeSeries(label: string, series: Sourced<Array<{ date: string }>>, unit?: string): Sourced<string> {
    const rows = series.value;
    return {
        value: rows.length > 0 ? `${label}: ${rows.length} daily values, ${rows[0].date} to ${rows[rows.length - 1].date}` : `${label}: no daily values`,
        unit: unit ?? series.unit,
        currency: series.currency,
        source: series.source,
        endpoint: series.endpoint,
        fetchedAt: series.fetchedAt,
        asOf: series.asOf,
        note: series.note,
    };
}

/** The held positions with their daily closes, the cash, and the USD/CAD history when a USD close needs it. */
async function gather(locale: Locale, scope: Scope): Promise<Gathered> {
    // The closes, the FX history and the profile do not depend on the prices: they load while the portfolio is valued
    const held = (await getPortfolioState(scope)).positions;
    const seriesOf = new Map(held.map((position) => {
        const entry = getEntry(position.symbol);
        const loading: Promise<Sourced<DailyClose[]> | null> = entry ? dailyClosesLongFor(entry).catch(() => null) : Promise.resolve(null);
        return [position.symbol, loading] as const;
    }));
    const [view, fx, profile] = await Promise.all([
        getPortfolio(locale, scope),
        fxUsdCadHistory(fxStart()).catch(() => null),
        getProfile(scope.profileUserId),
    ]);
    const priced = view.positions.filter((position) => position.valueCad !== null);
    const sources: Array<Sourced<string>> = [];
    let usedFx = false;

    const holdings = await Promise.all(priced.map(async (position): Promise<EngineHolding> => {
        const entry = getEntry(position.symbol);
        const series: Sourced<DailyClose[]> | null = await (seriesOf.get(position.symbol)
            ?? (entry ? dailyClosesLongFor(entry).catch(() => null) : Promise.resolve(null)));
        const currency = position.price?.currency ?? series?.currency ?? '';
        // A USD close with no exchange-rate history cannot be put in CAD: it is listed as having no history, never converted by a guess
        const usable = series && (currency === 'CAD' || (currency === 'USD' && fx)) ? series : null;
        if (usable) {
            sources.push(describeSeries(position.symbol, usable));
            if (currency === 'USD') usedFx = true;
        }
        return {
            symbol: position.symbol,
            name: position.name,
            group: renderText(serviceRef('svc.portfolio.group', { group: groupOf(position) }), locale),
            assetClass: position.assetClass,
            currency,
            valueCad: position.valueCad!,
            isCrypto: position.assetClass === 'crypto',
            closes: usable?.value ?? null,
        };
    }));
    if (usedFx && fx) sources.push(describeSeries('USD/CAD', fx, 'CAD per USD'));

    return {
        input: { holdings, cashCad: view.cashCad, fx: fx?.value ?? [] },
        unpriced: view.unpriced,
        sources,
        profile,
    };
}

// The engine is pure: the same input gives the same output. Its output is reused for an identical input (same
// holdings, values, cash, series and labels) for up to an hour. The key is a hash of that input only, so two
// visitors share an entry only if their inputs are identical, and the output then holds nothing but those inputs' figures.
const engineRuns = createViewCache<EngineOutput>('xray-engine', { softTtlMs: 60 * 60_000, maxEntries: 300 });

// The whole input is hashed (a few hundred kB of closes: about a millisecond), so only an identical input matches
const engineKey = (input: EngineInput): string => createHash('sha256').update(JSON.stringify(input)).digest('hex');

const runEngine = async (input: EngineInput): Promise<EngineOutput> =>
    structuredClone(await engineRuns.get(engineKey(input), async () => computeEngine(input)));

function assemble(out: EngineOutput, gathered: Gathered, sources: Array<Sourced<string>> = gathered.sources): XrayView {
    const { profile } = gathered;
    const full = out.windows.full;
    return {
        ...out,
        version: XRAY_VERSION,
        simulated: true,
        computedAt: new Date().toISOString(),
        asOf: full.available ? full.to : null,
        band: profile ? { risk: profile.risk, volatilityLimitPct: round2(RULES.filters.volatility.cap_by_risk[profile.risk] * 100) } : null,
        dropAnswer: profile?.answers.drop20 ?? null,
        unpriced: gathered.unpriced,
        method: METHOD,
        assumptions: ASSUMPTIONS,
        sources,
    };
}

/** The X-ray of the simulated portfolio as it stands, valued now. Text it carries (group names) is in `locale`. */
export async function getPortfolioXray(locale?: Locale, scope?: Scope): Promise<XrayView> {
    const gathered = await gather(locale ?? await getAppLocale(), scope ?? await currentScope());
    return assemble(await runEngine(gathered.input), gathered);
}

const EPSILON = 0.005;

/**
 * The X-ray before and after a hypothetical change of CAD `amountCad` in one asset: an addition spends cash (it
 * cannot exceed it), a reduction cannot exceed the position. For an addition, the profile conflicts the watchlist
 * filters would name, with their actual values. Nothing is traded or stored.
 */
export async function getXrayWhatIf(change: XrayChange, locale?: Locale, scope?: Scope): Promise<XrayWhatIf> {
    const lang = locale ?? await getAppLocale();
    const s = scope ?? await currentScope();
    const entry = getEntry(change.symbol);
    if (!entry) throw new ServiceError(404, serviceRef('svc.not_in_universe', { symbol: change.symbol }));
    if (!isTradable(entry)) throw new ServiceError(400, serviceRef('svc.reference_value', { name: entry.name }));
    if (!(typeof change.amountCad === 'number' && Number.isFinite(change.amountCad) && change.amountCad > 0)) {
        throw new ServiceError(400, serviceRef('svc.xray.bad_amount', {}));
    }
    const amount = round2(change.amountCad);

    const gathered = await gather(lang, s);
    const { input } = gathered;
    // The series the before side reads; an asset not held yet adds its own to the after side only
    const beforeSources = [...gathered.sources];
    const held = input.holdings.find((h) => h.symbol === entry.symbol);
    let holdings: EngineHolding[];
    let cashCad: number;
    let conflicts: FilterCheck[] = [];

    if (change.direction === 'add') {
        if (amount > input.cashCad + EPSILON) throw new ServiceError(400, serviceRef('svc.trade.cash_short', { cash: input.cashCad, need: amount }));
        const profile = gathered.profile;
        if (!profile) throw new ServiceError(409, serviceRef('svc.no_profile', {}));
        // The currency and the closes of an asset not held yet come from its own provider, as a trade would read them
        const quote = held ? null : await liveQuote(entry).catch(() => null);
        if (!held && !quote) throw new ServiceError(502, serviceRef('svc.trade.no_price', { symbol: entry.symbol }));
        const added: EngineHolding = held ?? await (async () => {
            const series = await dailyClosesLongFor(entry).catch(() => null);
            const currency = quote!.price.currency ?? series?.currency ?? '';
            const usable = series && (currency === 'CAD' || (currency === 'USD' && input.fx.length > 0)) ? series : null;
            if (usable) gathered.sources.push(describeSeries(entry.symbol, usable));
            return {
                symbol: entry.symbol, name: entry.name, currency, valueCad: 0, isCrypto: entry.assetClass === 'crypto',
                assetClass: entry.assetClass,
                group: renderText(serviceRef('svc.portfolio.group', { group: entry.sector ?? ({ etf: 'ETF', crypto: 'Crypto' } as Record<string, string>)[entry.assetClass] ?? 'Other' }), lang),
                closes: usable?.value ?? null,
            };
        })();
        holdings = held
            ? input.holdings.map((h) => (h.symbol === entry.symbol ? { ...h, valueCad: round2(h.valueCad + amount) } : h))
            : [...input.holdings, { ...added, valueCad: amount }];
        cashCad = round2(input.cashCad - amount);
        const { signals, fxUsdCad: signalFx } = await signalsFor(entry);
        conflicts = checkProfileConflict(signals, profile, RULES, signalFx, lang).conflicts;
    } else {
        if (!held) throw new ServiceError(400, serviceRef('svc.xray.not_held', { symbol: entry.symbol }));
        if (amount > held.valueCad + EPSILON) throw new ServiceError(400, serviceRef('svc.xray.reduce_too_large', { symbol: entry.symbol, held: held.valueCad, amount }));
        const remaining = round2(held.valueCad - amount);
        holdings = remaining <= EPSILON
            ? input.holdings.filter((h) => h.symbol !== entry.symbol)
            : input.holdings.map((h) => (h.symbol === entry.symbol ? { ...h, valueCad: remaining } : h));
        cashCad = round2(input.cashCad + amount);
    }

    // Before and after over the same dates and the same covered holdings (lib/xray/engine.ts computeComparison)
    const compared = computeComparison(input, { ...input, holdings, cashCad }, entry.symbol);
    return {
        change: { symbol: entry.symbol, amountCad: amount, direction: change.direction },
        before: assemble(compared.before, gathered, beforeSources),
        after: assemble(compared.after, gathered),
        conflicts,
        simulated: true,
    };
}
