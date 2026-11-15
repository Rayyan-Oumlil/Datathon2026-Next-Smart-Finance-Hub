// The simulated portfolio. Nothing is stored but the trades: cash and positions are a replay of the
// 'simulated_trade' rows of the decision log, so the log is the single source of truth. No real trade exists.

import { randomBytes } from 'node:crypto';
import { getAppLocale } from '@/i18n/locale';
import type { FilterCheck, HoldingsSummary, Portfolio, Position, SignalSet, SimulatedTrade, Sourced, TextRef } from '@/lib/domain/types';
import { isWeekday, newYorkNow, OPEN, sessionOf } from '@/lib/market-session';
import { RULES, RULES_VERSION } from '@/lib/rules';
import { marketDate } from '@/lib/sources/daily-signals';
import type { DailyClose } from '@/lib/sources/types';
import { currentScope, type Scope } from '@/lib/session';
import { appendDecision, getProfile, listDecisions } from '@/lib/store';
import { getEntry } from '@/lib/universe';
import { checkProfileConflict } from '@/lib/watchlist/conflict';
import type { Locale } from '@/lib/watchlist/text';
import { createViewCache } from './cache';
import { ServiceError, round2 } from './errors';
import { renderOr, renderText, serviceRef } from './text';
import { dailyClosesFor, fxUsdCad, isTradable, liveQuote, signalsFor, toCad } from './quotes';

const STARTING_CASH = RULES.simulated_portfolio.starting_cash;
const QUANTITY_DECIMALS = 6;      // fractional units, so a CAD amount can be simulated on any price
const EPSILON = 1e-9;
const roundQuantity = (quantity: number) => Math.round(quantity * 10 ** QUANTITY_DECIMALS) / 10 ** QUANTITY_DECIMALS;
// Rounded down, so the units an amount pays for never cost more than the amount
const floorQuantity = (quantity: number) => Math.floor(quantity * 10 ** QUANTITY_DECIMALS + 1e-6) / 10 ** QUANTITY_DECIMALS;

export type TradeInput = {
    symbol: string;
    side: 'buy' | 'sell';
    amountCad?: number;
    quantity?: number;
    origin?: SimulatedTrade['origin'];
    ruleId?: string;
    reason?: string;
    reasonRef?: TextRef;          // the reason as a catalog reference (the rules engine), so it can be shown in either language
    acknowledgeConflict?: boolean;
};

export type TradeOutcome =
    | { status: 'filled'; trade: SimulatedTrade; portfolio: Portfolio; conflicts: FilterCheck[]; unitPriceCad: number; fxUsdCad: Sourced | null }
    | { status: 'conflict'; conflicts: FilterCheck[]; signals: SignalSet; message: string };

export type PositionView = Position & {
    price: Sourced | null;
    changePercent: Sourced | null;
    valueCad: number | null;
    returnPct: number | null;
    dayChangeCad: number | null;                  // since the previous close; a part added in the session counts from its fill
    dayChangePct: number | null;                  // dayChangeCad against the position's value at that close plus what was added since
};

export type PortfolioView = {
    portfolio: Portfolio;
    valueCad: Sourced;
    cashCad: number;
    positions: PositionView[];
    bySector: Record<string, number>;             // sector (or asset class when it has none) -> value in CAD
    history: Array<{ t: string; valueCad: number }>;
    historyNote: string;
    historyCloses: number;                        // daily closes in the history; 0 means only the start and now
    dayChangeCad: number | null;                  // value now against the value at the previous close (trades since at their fill)
    market: { open: boolean; lastSession: string };   // lastSession: the date (YYYY-MM-DD) the day change belongs to
    fxUsdCad: Sourced | null;
    unpriced: string[];                           // held symbols with no price right now; not counted in valueCad
    simulated: true;
};

// ---------------------------------------------------------------- replay

/** Pure replay: starting cash, then every trade in order. The average cost of a position only moves on a purchase. */
export function replayTrades(trades: SimulatedTrade[], startingCashCad: number = STARTING_CASH): Portfolio {
    let cashCad = startingCashCad;
    const positions = new Map<string, Position>();
    for (const trade of trades) {
        const held = positions.get(trade.symbol);
        if (trade.side === 'buy') {
            cashCad -= trade.valueCad;
            const quantity = roundQuantity((held?.quantity ?? 0) + trade.quantity);
            const cost = (held ? held.quantity * held.avgCostCad : 0) + trade.valueCad;
            const entry = getEntry(trade.symbol);
            positions.set(trade.symbol, {
                symbol: trade.symbol,
                name: held?.name ?? entry?.name ?? trade.symbol,
                quantity,
                avgCostCad: cost / quantity,
                sector: held?.sector ?? entry?.sector,
                assetClass: held?.assetClass ?? entry?.assetClass ?? 'stock',
            });
        } else {
            cashCad += trade.valueCad;
            if (!held) continue;
            const quantity = roundQuantity(held.quantity - trade.quantity);
            if (quantity <= EPSILON) positions.delete(trade.symbol);
            else positions.set(trade.symbol, { ...held, quantity });
        }
    }
    return { cashCad: round2(cashCad), startingCashCad, positions: [...positions.values()], trades };
}

// Reading the log means reading every row of the portfolio, so the trades are read once per process and each new
// trade is added as it is appended. This process is the log's only writer. One entry per portfolio generation
// (`${sessionId}:f${n}`): a portfolio reset moves to a new id, whose replay starts from the starting cash alone.
const holder = globalThis as { __simulatedTrades?: Map<string, Promise<SimulatedTrade[]>>; __tradeQueue?: Promise<unknown> };
// Each visitor adds an entry; the oldest are forgotten (and read again from the log if that visitor comes back)
const MAX_CACHED_PORTFOLIOS = 1000;

function loadTrades(portfolioUserId: string): Promise<SimulatedTrade[]> {
    const cache = (holder.__simulatedTrades ??= new Map());
    let trades = cache.get(portfolioUserId);
    if (!trades) {
        trades = listDecisions(portfolioUserId, { kind: 'simulated_trade' })
            .then((rows) => rows.map((row) => (row.payload as { trade: SimulatedTrade }).trade))
            .catch((error) => {
                cache.delete(portfolioUserId);
                throw error;
            });
        if (cache.size >= MAX_CACHED_PORTFOLIOS) cache.delete(cache.keys().next().value as string);
        cache.set(portfolioUserId, trades);
    }
    return trades;
}

/** Forgets the trades held in memory; the next read replays the log. */
export function resetPortfolioCache(): void {
    holder.__simulatedTrades = new Map();
    views.clear();
}

const scopeOr = async (scope?: Scope): Promise<Scope> => scope ?? currentScope();

/** The simulated portfolio of the scope's portfolio generation (default: the current request's session). */
export async function getPortfolioState(scope?: Scope): Promise<Portfolio> {
    return replayTrades([...(await loadTrades((await scopeOr(scope)).portfolioUserId))]);
}

// ---------------------------------------------------------------- view

const sectorKey = (position: Position) => position.sector ?? ({ etf: 'ETF', crypto: 'Crypto' } as Record<string, string>)[position.assetClass] ?? 'Other';

// A screen shows the last quote held when a provider is slow (lib/services/quotes.ts forScreen); the quotes of all
// positions are asked at once, and the Finnhub module spreads them within its rate limit.
async function priced(portfolio: Portfolio): Promise<{ positions: Array<Omit<PositionView, 'dayChangeCad' | 'dayChangePct'>>; fx: Sourced | null }> {
    const fxPromise = fxUsdCad().catch(() => null);
    const quotes = portfolio.positions.map((position) => {
        const entry = getEntry(position.symbol);
        return entry ? liveQuote(entry, { forScreen: true }).catch(() => null) : Promise.resolve(null);
    });
    const fx = await fxPromise;
    const positions = await Promise.all(portfolio.positions.map(async (position, i) => {
        const quote = await quotes[i];
        const unitCad = quote ? toCad(quote.price.value, quote.price.currency, fx ?? undefined) : null;
        return {
            ...position,
            price: quote?.price ?? null,
            changePercent: quote?.changePercent ?? null,
            valueCad: unitCad === null ? null : round2(position.quantity * unitCad),
            returnPct: unitCad === null || !(position.avgCostCad > 0) ? null : round2((unitCad / position.avgCostCad - 1) * 100),
        };
    }));
    return { positions, fx };
}

/**
 * Value at each daily close since the first trade: the cash and quantities held at the end of that day, each
 * position at its last close on or before the day. A day is left out when a held symbol has no close for it.
 */
// A daily close is placed at 21:00 UTC, the end of the Toronto and New York session in winter time
const closeTime = (day: string) => `${day}T21:00:00.000Z`;

type Closes = { closes: Map<string, Sourced<DailyClose[]>>; withoutCloses: string[] };

/** The daily closes of every symbol ever traded (started before the quotes are read, so both load at once). */
async function tradedCloses(trades: SimulatedTrade[]): Promise<Closes> {
    const symbols = [...new Set(trades.map((trade) => trade.symbol))];
    const series = await Promise.all(symbols.map(async (symbol) => {
        const entry = getEntry(symbol);
        return entry ? dailyClosesFor(entry).catch(() => null) : null;
    }));
    const closes = new Map<string, Sourced<DailyClose[]>>();
    const withoutCloses: string[] = [];
    symbols.forEach((symbol, i) => {
        const found = series[i];
        if (found) closes.set(symbol, found);
        else withoutCloses.push(symbol);
    });
    return { closes, withoutCloses };
}

async function valueHistory(portfolio: Portfolio, fx: Sourced | null, now: string, valueNow: number | null, locale: Locale, loaded: Promise<Closes>): Promise<{ history: PortfolioView['history']; note: string; closes: number }> {
    const { trades } = portfolio;
    if (trades.length === 0) {
        return { history: [{ t: now, valueCad: portfolio.startingCashCad }], note: renderText(serviceRef('svc.portfolio.no_trade', {}), locale), closes: 0 };
    }
    const history = [{ t: trades[0].at, valueCad: portfolio.startingCashCad }];
    const today = marketDate(new Date(now));
    const { closes, withoutCloses } = await loaded;

    const firstDay = marketDate(new Date(trades[0].at));
    const days = [...new Set([...closes.values()].flatMap((series) => series.value.map((row) => row.date)))]
        .filter((date) => date >= firstDay && date < today && closeTime(date) > trades[0].at)
        .sort();
    for (const day of days) {
        const held = replayTrades(trades.filter((trade) => marketDate(new Date(trade.at)) <= day), portfolio.startingCashCad);
        let value: number | null = held.cashCad;
        for (const position of held.positions) {
            const series = closes.get(position.symbol);
            const close = series?.value.filter((row) => row.date <= day).pop();
            const unitCad = close && series ? toCad(close.close, series.currency, fx ?? undefined) : null;
            if (unitCad === null) {
                value = null;
                break;
            }
            value += position.quantity * unitCad;
        }
        if (value !== null) history.push({ t: closeTime(day), valueCad: round2(value) });
    }
    const closesShown = history.length - 1;
    if (valueNow !== null) history.push({ t: now, valueCad: valueNow });

    const sources = [...new Set([...closes.values()].map((series) => series.source))].join(', ');
    const note = renderText(serviceRef('svc.portfolio.history_note', { sources: days.length > 0 ? sources : null, withoutCloses }), locale);
    return { history, note, closes: closesShown };
}

// ---------------------------------------------------------------- session and day change

const DAY_MS = 24 * 60 * 60 * 1000;
const shiftDay = (day: string, by: number) => new Date(Date.parse(`${day}T12:00:00Z`) + by * DAY_MS).toISOString().slice(0, 10);
const previousWeekday = (day: string) => {
    let date = shiftDay(day, -1);
    while (!isWeekday(new Date(`${date}T12:00:00Z`).getUTCDay())) date = shiftDay(date, -1);
    return date;
};

/**
 * The session the day change belongs to: today once the market has opened on a weekday, otherwise the weekday
 * before. previousSession is the session before it, whose close is the day change's reference. Holidays are ignored.
 */
export function marketSession(now: Date): { open: boolean; lastSession: string; previousSession: string } {
    const { weekday, minutes } = newYorkNow(now);
    const today = marketDate(now);
    const lastSession = isWeekday(weekday) && minutes >= OPEN ? today : previousWeekday(today);
    return { open: sessionOf(weekday, minutes).phase === 'open', lastSession, previousSession: previousWeekday(lastSession) };
}

type DayChange = { change: number; base: number } | null;

/**
 * Each symbol's gain or loss since the previous close, so it adds up with the change since the start: the value now,
 * minus the value at that close of the quantity then held, minus what was added since at its fill (plus what was
 * taken out at its fill). A position bought in the session therefore starts at zero, not at the provider's day move.
 */
async function dayChanges(portfolio: Portfolio, positions: Array<Omit<PositionView, 'dayChangeCad' | 'dayChangePct'>>, previousSession: string): Promise<Map<string, DayChange>> {
    const inSession = (trade: SimulatedTrade) => marketDate(new Date(trade.at)) > previousSession;
    const atClose = replayTrades(portfolio.trades.filter((trade) => !inSession(trade)), portfolio.startingCashCad).positions;
    const added = new Map<string, number>();
    for (const trade of portfolio.trades.filter(inSession)) {
        added.set(trade.symbol, (added.get(trade.symbol) ?? 0) + (trade.side === 'buy' ? trade.valueCad : -trade.valueCad));
    }
    // A position held at the close and wholly removed since still has a day result: priced at the quantity it had
    const gone = atClose.filter((held) => !positions.some((position) => position.symbol === held.symbol));
    const removed = gone.length > 0 ? (await priced({ ...portfolio, positions: gone })).positions : [];

    const result = new Map<string, DayChange>();
    for (const position of [...positions, ...removed]) {
        const heldAtClose = atClose.find((held) => held.symbol === position.symbol)?.quantity ?? 0;
        const valueNow = removed.includes(position) ? 0 : position.valueCad;
        let valueAtClose = 0;
        if (heldAtClose > 0) {
            if (position.valueCad === null || !position.changePercent) {
                result.set(position.symbol, null);
                continue;
            }
            valueAtClose = (position.valueCad * heldAtClose / position.quantity) / (1 + position.changePercent.value / 100);
        }
        if (valueNow === null) {
            result.set(position.symbol, null);
            continue;
        }
        const base = valueAtClose + (added.get(position.symbol) ?? 0);
        result.set(position.symbol, { change: valueNow - base, base });
    }
    return result;
}

/** A logged trade with its reason in the language (a reason given as plain text stays as given). */
export function renderTrade(trade: SimulatedTrade, locale: Locale): SimulatedTrade {
    return trade.reasonRef ? { ...trade, reason: renderOr(trade.reasonRef, locale, trade.reason) } : trade;
}

// The valued portfolio of one portfolio generation in one language. The key starts with the portfolio user id
// (`${sessionId}:f${n}`, from the signed session cookie), so a visitor only ever reads views computed from their
// own trades. A view is reused for 10 s, served while it is refreshed up to 30 s, and dropped on every trade of
// that generation (a rule firing trades through the same path); a reset moves the session to a new id.
// The view keeps the time it was computed (valueCad.fetchedAt) and each price keeps its own fetchedAt.
const views = createViewCache<PortfolioView>('portfolio-view', { softTtlMs: 10_000, hardTtlMs: 30_000, maxEntries: 500 });
const viewKey = (portfolioUserId: string, locale: Locale) => `${portfolioUserId}|${locale}`;

/** Drops the cached views of one portfolio generation (called after each trade). */
export function invalidatePortfolioViews(portfolioUserId: string): void {
    views.invalidatePrefix(`${portfolioUserId}|`);
}

/**
 * The simulated portfolio, valued now. Its notes, the trades' reasons and the names of the groups in bySector
 * (a sector, or ETF / Crypto / Other for a position with no sector) are in `locale` (default: the request's language).
 */
export async function getPortfolio(locale?: Locale, scope?: Scope): Promise<PortfolioView> {
    const lang = locale ?? await getAppLocale();
    const s = await scopeOr(scope);
    // A copy, so a caller changing its view cannot change another caller's
    return structuredClone(await views.get(viewKey(s.portfolioUserId, lang), () => computePortfolio(lang, s)));
}

async function computePortfolio(lang: Locale, scope: Scope): Promise<PortfolioView> {
    const stored = await getPortfolioState(scope);
    const portfolio = { ...stored, trades: stored.trades.map((trade) => renderTrade(trade, lang)) };
    const now = new Date().toISOString();
    const closesLoading = tradedCloses(portfolio.trades);
    closesLoading.catch(() => undefined);
    const { positions: valued, fx } = await priced(portfolio);
    const session = marketSession(new Date(now));
    const byDay = await dayChanges(portfolio, valued, session.previousSession);
    const positions: PositionView[] = valued.map((position) => {
        const day = byDay.get(position.symbol);
        return {
            ...position,
            dayChangeCad: day ? round2(day.change) : null,
            dayChangePct: day && day.base > 0 ? round2((day.change / day.base) * 100) : null,
        };
    });
    const unpriced = positions.filter((position) => position.valueCad === null).map((position) => position.symbol);
    const total = round2(portfolio.cashCad + positions.reduce((sum, position) => sum + (position.valueCad ?? 0), 0));

    const bySector: Record<string, number> = {};
    for (const position of positions) {
        const group = renderText(serviceRef('svc.portfolio.group', { group: sectorKey(position) }), lang);
        if (position.valueCad !== null) bySector[group] = round2((bySector[group] ?? 0) + position.valueCad);
    }

    // The session's gain or loss: the sum over every symbol held at the previous close or traded since (cash moves
    // between positions and cash are not a gain), so a portfolio whose trades all date from the session matches the
    // change since the start
    let dayChangeCad: number | null = 0;
    for (const day of byDay.values()) {
        if (day === null) {
            dayChangeCad = null;
            break;
        }
        dayChangeCad += day.change;
    }

    const priceSources = [...new Set(positions.flatMap((position) => (position.price ? [position.price.source] : [])))];
    const valueCad: Sourced = {
        value: total,
        unit: 'CAD',
        currency: 'CAD',
        source: 'derived',
        fetchedAt: now,
        note: renderText(serviceRef('svc.portfolio.value_note', {
            priceSources,
            ...(fx && positions.some((position) => position.price?.currency === 'USD')
                ? { fxValue: fx.value, fxSource: fx.source, fxAsOf: fx.asOf ?? fx.fetchedAt }
                : { fxValue: null, fxSource: null, fxAsOf: null }),
            unpriced,
        }), lang),
    };
    const { history, note, closes } = await valueHistory(portfolio, fx, now, unpriced.length === 0 ? total : null, lang, closesLoading);
    return {
        portfolio,
        valueCad,
        cashCad: portfolio.cashCad,
        positions,
        bySector,
        history,
        historyNote: note,
        historyCloses: closes,
        dayChangeCad: dayChangeCad === null ? null : round2(dayChangeCad),
        market: { open: session.open, lastSession: session.lastSession },
        fxUsdCad: fx,
        unpriced,
        simulated: true,
    };
}

/** How each position was valued in a holdings summary, so a value taken at cost is never mistaken for a price. */
export type HoldingDetail = {
    symbol: string;
    quantity: number;
    price: Sourced | null;
    valuedAt: 'last price' | 'average cost (no price available)';
    fxUsdCad: Sourced | null;       // the rate a USD price was converted with; null for a CAD price or no price
};

/**
 * What the watchlist's diversification factor reads, with the valuation of each position beside it.
 * A position with no price is counted at its cost, and its detail says so.
 */
export async function holdingsWithDetail(scope?: Scope): Promise<{ summary: HoldingsSummary; detail: HoldingDetail[] }> {
    const portfolio = await getPortfolioState(scope);
    if (portfolio.positions.length === 0) return { summary: { totalValueCad: portfolio.cashCad, bySector: {}, byAssetClass: {}, symbols: [] }, detail: [] };
    const { positions, fx } = await priced(portfolio);
    const summary: HoldingsSummary = { totalValueCad: portfolio.cashCad, bySector: {}, byAssetClass: {}, symbols: positions.map((position) => position.symbol).sort() };
    const detail: HoldingDetail[] = [];
    for (const position of positions) {
        const value = position.valueCad ?? round2(position.quantity * position.avgCostCad);
        summary.totalValueCad = round2(summary.totalValueCad + value);
        if (position.sector) summary.bySector[position.sector] = round2((summary.bySector[position.sector] ?? 0) + value);
        summary.byAssetClass[position.assetClass] = round2((summary.byAssetClass[position.assetClass] ?? 0) + value);
        const atPrice = position.valueCad !== null;
        detail.push({
            symbol: position.symbol,
            quantity: position.quantity,
            price: position.price,
            valuedAt: atPrice ? 'last price' : 'average cost (no price available)',
            fxUsdCad: atPrice && position.price?.currency === 'USD' ? fx : null,
        });
    }
    return { summary, detail };
}

export async function holdingsSummary(scope?: Scope): Promise<HoldingsSummary> {
    return (await holdingsWithDetail(scope)).summary;
}

// ---------------------------------------------------------------- trades

/** A filter check as a catalog reference, or its detail as written when it has none. */
const refOf = (check: FilterCheck): TextRef | string => check.textRef ?? check.detail;

async function fill(input: TradeInput, locale: Locale, scope: Scope): Promise<TradeOutcome> {
    const entry = getEntry(input.symbol);
    if (!entry) throw new ServiceError(404, serviceRef('svc.trade.not_in_universe', { symbol: input.symbol }));
    if (!isTradable(entry)) throw new ServiceError(400, serviceRef('svc.reference_value', { name: entry.name }));
    const hasAmount = input.amountCad !== undefined;
    const given = hasAmount ? input.amountCad : input.quantity;
    if (hasAmount === (input.quantity !== undefined) || !(typeof given === 'number' && Number.isFinite(given) && given > 0)) {
        throw new ServiceError(400, serviceRef('svc.trade.amount_or_quantity', {}));
    }
    const profile = await getProfile(scope.profileUserId);
    if (!profile) throw new ServiceError(409, serviceRef('svc.no_profile', {}));
    const origin = input.origin ?? 'card';

    // No price with a source, no trade
    const quote = await liveQuote(entry).catch(() => null);
    if (!quote) throw new ServiceError(502, serviceRef('svc.trade.no_price', { symbol: entry.symbol }));
    const { price } = quote;
    const fx = price.currency === 'CAD' ? undefined : await fxUsdCad().catch(() => undefined);
    const unitCad = toCad(price.value, price.currency, fx);
    if (unitCad === null) throw new ServiceError(502, serviceRef('svc.trade.no_conversion', { symbol: entry.symbol, currency: price.currency ?? null }));

    // The amounts are checked before the conflict is logged, so the log holds no conflict for a trade that could not happen
    const before = await getPortfolioState(scope);
    const held = before.positions.find((position) => position.symbol === entry.symbol)?.quantity ?? 0;
    let quantity = hasAmount ? floorQuantity(given / unitCad) : roundQuantity(given);
    // An amount equal to the value of the whole position removes all of it, leaving no remainder from rounding
    if (input.side === 'sell' && hasAmount && held > 0 && Math.abs(given - round2(held * unitCad)) < 0.005) quantity = held;
    if (!(quantity > 0)) throw new ServiceError(400, serviceRef('svc.trade.too_small', { amount: given, unit: unitCad }));
    const valueCad = round2(quantity * unitCad);
    if (input.side === 'buy' && valueCad > before.cashCad + EPSILON) {
        throw new ServiceError(400, serviceRef('svc.trade.cash_short', { cash: before.cashCad, need: valueCad }));
    }
    if (input.side === 'sell' && quantity > held + EPSILON) {
        throw new ServiceError(400, serviceRef('svc.trade.position_short', { symbol: entry.symbol, held, quantity }));
    }

    // Profile-conflict check on purchases: name the conflict with the actual values, then let the user proceed
    let conflicts: FilterCheck[] = [];
    let conflictDecisionId: string | undefined;
    if (input.side === 'buy') {
        const { signals, fxUsdCad: signalFx } = await signalsFor(entry);
        conflicts = checkProfileConflict(signals, profile, RULES, signalFx ?? fx, locale).conflicts;
        if (conflicts.length > 0) {
            const proceeds = origin === 'rule' || input.acknowledgeConflict === true;
            const logged = await appendDecision({
                userId: scope.portfolioUserId,
                kind: 'profile_conflict',
                symbol: entry.symbol,
                ruleVersions: { rules: RULES_VERSION, filters: RULES.filters.version, level: profile.ruleVersions.level, risk: profile.ruleVersions.risk },
                payload: { conflicts, level: profile.level, risk: profile.risk, origin, ruleId: input.ruleId, acknowledged: input.acknowledgeConflict === true, proceeded: proceeds, signals, simulated: true },
            });
            conflictDecisionId = logged.id;
            if (!proceeds) {
                const message = renderText(serviceRef('svc.trade.conflict', {
                    symbol: entry.symbol, level: profile.level, risk: profile.risk, conflicts: conflicts.map(refOf),
                }), locale);
                return { status: 'conflict', conflicts, signals, message };
            }
        }
    }

    // The replay follows the log's time order, so each trade is at least 1 ms after the one before it
    const lastAt = before.trades.length > 0 ? Date.parse(before.trades[before.trades.length - 1].at) : 0;
    // A reason given as plain text (the agent) is kept as given; the app's own reasons keep their catalog reference
    const base: TextRef | string = input.reasonRef ?? input.reason ?? serviceRef('svc.trade.reason_default', { side: input.side, origin });
    const reasonRef = serviceRef('svc.trade.reason', { base, conflicts: conflicts.map(refOf) });
    const trade: SimulatedTrade = {
        id: `trade_${randomBytes(6).toString('hex')}`,
        at: new Date(Math.max(Date.now(), lastAt + 1)).toISOString(),
        symbol: entry.symbol,
        side: input.side,
        quantity,
        price,
        currency: price.currency ?? 'CAD',
        valueCad,
        origin,
        ...(input.ruleId ? { ruleId: input.ruleId } : {}),
        reason: renderText(reasonRef, locale),
        reasonRef,
        simulated: true,
    };
    await appendDecision({
        userId: scope.portfolioUserId,
        kind: 'simulated_trade',
        symbol: entry.symbol,
        at: trade.at,
        // The filters are what the profile-conflict check of a purchase reads
        ruleVersions: { rules: RULES_VERSION, filters: RULES.filters.version },
        payload: { trade, unitPriceCad: unitCad, fxUsdCad: fx, conflicts, conflictDecisionId, cashBeforeCad: before.cashCad, simulated: true },
    });
    (await loadTrades(scope.portfolioUserId)).push(trade);
    invalidatePortfolioViews(scope.portfolioUserId);
    return { status: 'filled', trade, portfolio: await getPortfolioState(scope), conflicts, unitPriceCad: unitCad, fxUsdCad: fx ?? null };
}

/**
 * Simulates one fill at the last price. Trades run one at a time, so two requests cannot both spend the same cash.
 * A purchase of an asset that fails the profile's filters comes back as a conflict unless acknowledged (a rule
 * always proceeds); the conflict is logged either way.
 * Its messages, conflict details and reason are written in `locale` (default: the request's language); the trade
 * keeps its reason's catalog reference, so the log can show it in either language.
 */
export async function simulateTrade(input: TradeInput, locale?: Locale, scope?: Scope): Promise<TradeOutcome> {
    // Resolved before queuing: the request's cookies are read while the request is still being served
    const lang = locale ?? await getAppLocale();
    const s = await scopeOr(scope);
    const run = () => fill(input, lang, s);
    const result = (holder.__tradeQueue ?? Promise.resolve()).then(run, run);
    holder.__tradeQueue = result.catch(() => undefined);
    return result;
}
