// Suggested portfolios ("Voyons ce que ça donnerait", brief B9, docs/v2-plan.md step 2). The options come from the
// versioned table rules/v1.json -> model_portfolios, never from a model. buildModelOptions is pure: it reads the
// table for the profile's risk level and applies the table's adjustments in their written order, moving whole
// points between lines. Every line keeps the rules that produced it (a code and values, rendered by next-intl
// messages in Start.why.*). The thin service around it adds names in the request's language, risk figures over the
// replay snapshot (lib/xray, same method as the X-ray) and the "apply" step through the normal trade path.

import type { OnboardingAnswers, Risk, UniverseEntry } from '@/lib/domain/types';
import { personaOfSession } from '@/lib/personas';
import { getReplayProvider, listReplaySymbols } from '@/lib/replay';
import { RULES } from '@/lib/rules';
import { currentScope, type Scope } from '@/lib/session';
import { performReset, resetSummary } from '@/lib/session/reset';
import { appendDecision, getProfile } from '@/lib/store';
import { getEntry } from '@/lib/universe';
import type { Locale } from '@/lib/watchlist/text';
import { computeEngine } from '@/lib/xray/engine';
import type { EngineHolding } from '@/lib/xray/types';
import { createViewCache } from './cache';
import { ServiceError, round2 } from './errors';
import { getPortfolioState, setStartingCash, simulateTrade } from './portfolio';

// ---------------------------------------------------------------- the table

export const MODEL_TABLE = RULES.model_portfolios;
export const MODEL_PORTFOLIOS_VERSION: string = MODEL_TABLE.version;

export type Role = (typeof MODEL_TABLE.roles)[number] | string;
export type AdjustmentId = 'base' | 'crypto_high_only' | 'esg' | 'markets_canada' | 'avoid' | 'theme_ai' | 'theme_dividends';

/** One reason a line has its weight: the rule (table version + adjustment id), a message code, and its values. */
export type Why = { rule: AdjustmentId; code: string; values: Record<string, string | number> };

export type ModelLine = { symbol: string; weightPct: number; role: Role; why: Why[] };

export type ModelOption = {
    id: string;
    risk: Risk;
    variant: 'defensive' | 'core' | 'growth';
    name: { fr: string; en: string };
    description: { fr: string; en: string };
    broadFund: string;
    lines: ModelLine[];
    adjustments: AdjustmentId[];      // the adjustments that changed this option, in the order they ran
};

type TableOption = { id: string; variant: string; name: { fr: string; en: string }; description: { fr: string; en: string }; lines: Array<{ symbol: string; weightPct: number; role: string }> };
type Replace = Record<string, { to: string; role: string }>;

export type ProfileInput = { risk: Risk; answers: Pick<OnboardingAnswers, 'markets' | 'themes' | 'avoid'> };

const lookupDefault = (symbol: string): UniverseEntry | undefined => getEntry(symbol);

// ---------------------------------------------------------------- the pure part

class Builder {
    lines: ModelLine[];
    broadFund: string;
    applied: AdjustmentId[] = [];

    constructor(option: TableOption, risk: Risk) {
        this.broadFund = (MODEL_TABLE.broad_fund as Record<Risk, string>)[risk];
        this.lines = option.lines.map((line) => ({
            symbol: line.symbol,
            weightPct: line.weightPct,
            role: line.role,
            why: [{ rule: 'base', code: 'base', values: { weight: line.weightPct, risk, version: MODEL_PORTFOLIOS_VERSION } }],
        }));
    }

    find(symbol: string): ModelLine | undefined {
        return this.lines.find((line) => line.symbol === symbol);
    }

    mark(rule: AdjustmentId) {
        if (!this.applied.includes(rule)) this.applied.push(rule);
    }

    /** Adds weight to a line (creating it at the end when missing) with the reason. */
    give(symbol: string, points: number, role: Role, why: Why) {
        const line = this.find(symbol);
        if (line) {
            line.weightPct += points;
            line.why.push(why);
        } else {
            this.lines.push({ symbol, weightPct: points, role, why: [why] });
        }
    }

    remove(symbol: string): ModelLine | undefined {
        const index = this.lines.findIndex((line) => line.symbol === symbol);
        return index < 0 ? undefined : this.lines.splice(index, 1)[0];
    }

    /** Where a removed line's weight goes: the broad fund, else (the broad fund itself removed) the largest line left. */
    receiver(): ModelLine | undefined {
        const broad = this.find(this.broadFund);
        if (broad) return broad;
        return [...this.lines].sort((a, b) => b.weightPct - a.weightPct)[0];
    }

    /** Removes a line and hands its weight to the receiver, with a why on the receiving line. */
    moveOut(symbol: string, rule: AdjustmentId, code: string, values: Record<string, string | number> = {}) {
        const removed = this.remove(symbol);
        if (!removed) return;
        const to = this.receiver();
        if (!to) return;
        to.weightPct += removed.weightPct;
        to.why.push({ rule, code, values: { ...values, from: symbol, points: removed.weightPct } });
        this.mark(rule);
    }

    replace(map: Replace, rule: AdjustmentId, code: string) {
        for (const [from, { to, role }] of Object.entries(map)) {
            const removed = this.remove(from);
            if (!removed) continue;
            this.give(to, removed.weightPct, role, { rule, code, values: { from, to, points: removed.weightPct } });
            if (this.broadFund === from) this.broadFund = to;
            this.mark(rule);
        }
    }

    /** Moves up to `points` from the broad fund to the targets the option holds, split evenly. */
    tilt(targets: string[], points: number, rule: AdjustmentId, codeIn: string, codeOut: string) {
        const source = this.find(this.broadFund);
        const held = this.lines.filter((line) => targets.includes(line.symbol) && line.symbol !== this.broadFund);
        if (!source || held.length === 0) return;
        const moving = Math.min(points, source.weightPct);
        if (moving <= 0) return;
        const base = Math.floor(moving / held.length);
        let remainder = moving - base * held.length;
        source.weightPct -= moving;
        const names: string[] = [];
        for (const line of held) {
            const share = base + (remainder > 0 ? 1 : 0);
            if (remainder > 0) remainder -= 1;
            if (share === 0) continue;
            line.weightPct += share;
            line.why.push({ rule, code: codeIn, values: { points: share, from: source.symbol } });
            names.push(line.symbol);
        }
        source.why.push({ rule, code: codeOut, values: { points: moving, to: names.join(', ') } });
        if (source.weightPct === 0) this.remove(source.symbol);
        this.mark(rule);
    }
}

const has = (list: string[], value: string) => list.some((item) => item.trim().toLowerCase() === value.toLowerCase());

/**
 * The three options of the profile's risk level, adjusted by the table's rules. Pure and deterministic: the same
 * profile always gives the same lines, weights and reasons. Weights stay whole points summing to 100.
 */
export function buildModelOptions(profile: ProfileInput, lookup: (symbol: string) => UniverseEntry | undefined = lookupDefault): ModelOption[] {
    const { risk, answers } = profile;
    const table = (MODEL_TABLE.options as Record<Risk, TableOption[]>)[risk];
    const adj = MODEL_TABLE.adjustments;
    const themes = answers.themes ?? [];
    const avoid = answers.avoid ?? [];

    return table.map((option) => {
        const b = new Builder(option, risk);
        for (const step of MODEL_TABLE.adjustments_order as AdjustmentId[]) {
            if (step === 'crypto_high_only' && risk !== 'High') {
                for (const line of [...b.lines]) {
                    if (lookup(line.symbol)?.assetClass === 'crypto' || line.role === 'crypto') b.moveOut(line.symbol, step, 'crypto_removed');
                }
            }
            if (step === 'esg' && has(themes, 'ESG')) b.replace(adj.esg.replace as Replace, step, 'esg_replaced');
            if (step === 'markets_canada' && answers.markets === 'Canada') {
                b.replace(adj.markets_canada.replace as Replace, step, 'canada_replaced');
                b.broadFund = adj.markets_canada.broad_fund;
                if (!b.find(b.broadFund)) b.lines.push({ symbol: b.broadFund, weightPct: 0, role: 'canada_equity', why: [] });
                for (const line of [...b.lines]) {
                    const entry = lookup(line.symbol);
                    if (entry?.assetClass === 'stock' && entry.market === 'US') b.moveOut(line.symbol, step, 'canada_stock_moved');
                }
                for (const symbol of Object.keys(adj.markets_canada.kept)) {
                    const line = b.find(symbol);
                    if (line) {
                        line.why.push({ rule: step, code: 'canada_kept', values: { symbol } });
                        b.mark(step);
                    }
                }
            }
            if (step === 'avoid' && avoid.length > 0) {
                for (const line of [...b.lines]) {
                    const entry = lookup(line.symbol);
                    const hit = avoid.find((item) => item.trim().toUpperCase() === line.symbol.toUpperCase()
                        || (entry?.sector !== undefined && item.trim().toLowerCase() === entry.sector.toLowerCase()));
                    if (hit) b.moveOut(line.symbol, step, 'avoid_moved', { item: hit });
                }
            }
            if (step === 'theme_ai' && has(themes, 'AI')) b.tilt(adj.theme_ai.targets, adj.theme_ai.points, step, 'ai_in', 'ai_out');
            if (step === 'theme_dividends' && has(themes, 'dividends')) {
                b.tilt(adj.theme_dividends.targets, adj.theme_dividends.points, step, 'dividends_in', 'dividends_out');
            }
        }
        return {
            id: option.id,
            risk,
            variant: option.variant as ModelOption['variant'],
            name: option.name,
            description: option.description,
            broadFund: b.broadFund,
            lines: b.lines.filter((line) => line.weightPct > 0).sort((x, y) => y.weightPct - x.weightPct),
            adjustments: b.applied,
        };
    });
}

// ---------------------------------------------------------------- the service

export type OptionFigures = {
    snapshotId: string;
    from: string;
    to: string;
    volatilityPct: number;
    maxDrawdownPct: number;
    worstDayPct: number;
    coveragePct: number;
};

export type ModelOptionView = Omit<ModelOption, 'name' | 'description' | 'lines'> & {
    name: string;
    description: string;
    lines: Array<ModelLine & { name: string }>;
    figures: OptionFigures | null;
};

export type ModelPortfoliosView = {
    version: string;
    simulated: true;
    risk: Risk;
    markets: string;
    themes: string[];
    cashCad: number;
    minAmountCad: number;
    maxAmountCad: number;             // the simulated cash the option would be placed with (a fresh generation starts with the full starting cash)
    defaultAmountCad: number;
    hasPortfolio: boolean;
    positions: number;
    persona: string | null;
    options: ModelOptionView[];
};

export const MIN_APPLY_CAD: number = 500;

const scopeOr = async (scope?: Scope): Promise<Scope> => scope ?? currentScope();

// Figures depend only on the weights and the frozen snapshot: computed once per distinct set of lines (and snapshot)
// in this process, shared by every visitor (they hold no personal data). A failure is not kept: the next call retries.
const figuresCache = createViewCache<OptionFigures | null>('model-portfolio-figures', { softTtlMs: 24 * 60 * 60_000, maxEntries: 200 });
const figuresKey = (option: ModelOption) => `${process.env.REPLAY_SNAPSHOT_ID ?? ''}|${option.lines.map((line) => `${line.symbol}:${line.weightPct}`).join('|')}`;

async function figuresOf(option: ModelOption): Promise<OptionFigures | null> {
    try {
        return await figuresCache.get(figuresKey(option), () => computeFigures(option));
    } catch (error) {
        console.warn('model portfolio figures unavailable:', error instanceof Error ? error.message : error);
        return null;
    }
}

/**
 * Loads the replay snapshot and computes the figures of every risk level's base options, in the background, so the
 * first visitor of the suggested portfolios or the time machine does not wait for the files. Runs once per process,
 * 1.5 s after it is first called.
 */
export function warmModelPortfolios(): void {
    const holder = globalThis as { __modelPortfoliosWarm?: boolean };
    if (holder.__modelPortfoliosWarm) return;
    holder.__modelPortfoliosWarm = true;
    // A moment after the first page, so reading the files does not slow that page down
    const warm = async () => {
        const provider = getReplayProvider();
        const symbols = (await listReplaySymbols()).map((row) => row.symbol);
        await Promise.all([provider.describe(), provider.getFx(), provider.getDailyPrices(symbols)]);
        const risks = Object.keys(MODEL_TABLE.options) as Risk[];
        const options = risks.flatMap((risk) => buildModelOptions({ risk, answers: { markets: 'global', themes: [], avoid: [] } }));
        await Promise.all(options.map(figuresOf));
    };
    setTimeout(() => {
        warm().catch((error) => {
            console.warn('replay snapshot warm-up failed:', error instanceof Error ? error.message : error);
        });
    }, 1500);
}

/** The X-ray engine on snapshot closes: today's weights applied to every past day (no dividends), full window. */
async function computeFigures(option: ModelOption): Promise<OptionFigures | null> {
    const provider = getReplayProvider();
    const symbols = option.lines.map((line) => line.symbol);
    const [tables, fx, description] = await Promise.all([provider.getDailyPrices(symbols), provider.getFx(), provider.describe()]);
    const notional = 10_000;
    const holdings: EngineHolding[] = option.lines.map((line, i) => {
        const entry = getEntry(line.symbol);
        const rows = tables[i]?.rows ?? [];
        return {
            symbol: line.symbol,
            name: entry?.name ?? line.symbol,
            group: entry?.sector ?? (entry?.assetClass === 'crypto' ? 'Crypto' : 'ETF'),
            assetClass: entry?.assetClass ?? 'etf',
            currency: rows[0]?.currency ?? 'USD',
            valueCad: (notional * line.weightPct) / 100,
            isCrypto: entry?.assetClass === 'crypto',
            closes: rows.length > 0 ? rows.map((row) => ({ date: row.date, close: row.close })) : null,
        };
    });
    const out = computeEngine({ holdings, cashCad: 0, fx: fx.rows.map((row) => ({ date: row.date, rate: row.usdcad })) });
    const full = out.windows.full;
    if (!full.available) return null;
    return {
        snapshotId: description.datasetId,
        from: full.from,
        to: full.to,
        volatilityPct: full.volatilityPct,
        maxDrawdownPct: full.maxDrawdown.pct,
        worstDayPct: full.worstDay.pct,
        coveragePct: full.coverage.sharePct,
    };
}

async function profileOf(scope: Scope) {
    const profile = await getProfile(scope.profileUserId);
    if (!profile) throw new ServiceError(409, 'No profile yet: complete the onboarding first.');
    return profile;
}

/** The three options for the current visitor's profile, in `locale`, with risk figures over the snapshot. */
export async function getModelPortfolios(locale: Locale, scope?: Scope): Promise<ModelPortfoliosView> {
    const s = await scopeOr(scope);
    const [profile, portfolio] = await Promise.all([profileOf(s), getPortfolioState(s)]);
    const options = buildModelOptions({ risk: profile.risk, answers: profile.answers });
    const figures = await Promise.all(options.map(figuresOf));
    const hasPortfolio = portfolio.positions.length > 0 || portfolio.trades.length > 0;
    // A new portfolio starts with the amount its owner picks, up to the rules file's starting cash
    const maxAmountCad = Math.floor(RULES.simulated_portfolio.starting_cash);
    return {
        version: MODEL_PORTFOLIOS_VERSION,
        simulated: true,
        risk: profile.risk,
        markets: profile.answers.markets,
        themes: profile.answers.themes,
        cashCad: round2(portfolio.cashCad),
        minAmountCad: MIN_APPLY_CAD,
        maxAmountCad,
        defaultAmountCad: Math.min(10_000, maxAmountCad),
        hasPortfolio,
        positions: portfolio.positions.length,
        persona: personaOfSession(s.sessionId),
        options: options.map((option, i) => ({
            ...option,
            name: option.name[locale],
            description: option.description[locale],
            lines: option.lines.map((line) => ({ ...line, name: getEntry(line.symbol)?.name ?? line.symbol })),
            figures: figures[i],
        })),
    };
}

export type ApplyResult = {
    ok: true;
    next: '/strategy';
    optionId: string;
    amountCad: number;
    replaced: boolean;
    placed: Array<{ symbol: string; amountCad: number; valueCad: number }>;
    skipped: Array<{ symbol: string; reason: string }>;
};

/**
 * Creates the simulated portfolio of one option through the normal trade path (simulateTrade, like the example users'
 * seeding). Only on an empty simulated portfolio, or with `replace`, which first opens a new portfolio generation
 * (lib/session/reset.ts; nothing is deleted, the old generation stays in the logs).
 */
export async function applyModelPortfolio(input: { optionId: string; amountCad: number; replace?: boolean }, scope?: Scope): Promise<ApplyResult> {
    let s = await scopeOr(scope);
    const profile = await profileOf(s);
    const option = buildModelOptions({ risk: profile.risk, answers: profile.answers }).find((o) => o.id === input.optionId);
    if (!option) throw new ServiceError(404, `Unknown option "${input.optionId}" for a ${profile.risk} risk profile.`);

    let portfolio = await getPortfolioState(s);
    let replaced = false;
    if (portfolio.positions.length > 0 || portfolio.trades.length > 0) {
        if (!input.replace) throw new ServiceError(409, 'A simulated portfolio already exists: send replace=true to start a new one.');
        s = (await performReset(s, 'portfolio', await resetSummary(s, 'portfolio'))).scope;
        portfolio = await getPortfolioState(s);
        replaced = true;
    }
    const amountCad = round2(input.amountCad);
    const maxCad = RULES.simulated_portfolio.starting_cash;
    if (!(amountCad >= MIN_APPLY_CAD) || amountCad > maxCad + 1e-6) {
        throw new ServiceError(400, `The amount must be between ${MIN_APPLY_CAD} and ${maxCad} CAD.`);
    }
    // The portfolio is worth what its owner chose: that amount is its starting cash, not a share of a fixed 10 000
    await setStartingCash(amountCad, s);

    // Every symbol must still be in the snapshot and tradable: the table is checked by a test, this keeps it honest at run time
    const replayable = new Set((await listReplaySymbols()).map((r) => r.symbol));
    const placed: ApplyResult['placed'] = [];
    const skipped: ApplyResult['skipped'] = [];
    for (const line of option.lines) {
        if (!getEntry(line.symbol) || !replayable.has(line.symbol)) {
            skipped.push({ symbol: line.symbol, reason: 'not in the app universe or the replay snapshot' });
            continue;
        }
        // One cent below the exact share, so rounding never asks for more cash than is left
        const lineCad = round2(Math.max(0, (amountCad * line.weightPct) / 100 - 0.01));
        try {
            const outcome = await simulateTrade({ symbol: line.symbol, side: 'buy', amountCad: lineCad, origin: 'card', acknowledgeConflict: true }, 'fr', s);
            if (outcome.status === 'filled') placed.push({ symbol: line.symbol, amountCad: lineCad, valueCad: outcome.trade.valueCad });
            else skipped.push({ symbol: line.symbol, reason: `profile conflict: ${outcome.message}` });
        } catch (error) {
            skipped.push({ symbol: line.symbol, reason: error instanceof Error ? error.message : String(error) });
        }
    }
    await appendDecision({
        userId: s.sessionLogId,
        kind: 'user_action',
        ruleVersions: { model_portfolios: MODEL_PORTFOLIOS_VERSION },
        payload: {
            action: 'model_portfolio_applied', optionId: option.id, risk: profile.risk, amountCad, replaced,
            lines: option.lines.map(({ symbol, weightPct, role, why }) => ({ symbol, weightPct, role, why })),
            placed, skipped, origin: 'user', simulated: true,
        },
    });
    if (skipped.length > 0) console.warn(`model portfolio ${option.id}: ${skipped.length} line(s) skipped`, skipped);
    return { ok: true, next: '/strategy', optionId: option.id, amountCad, replaced, placed, skipped };
}
