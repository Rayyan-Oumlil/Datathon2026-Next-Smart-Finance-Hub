import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { GET as DECISIONS } from '@/app/api/decisions/route';
import { PATCH, POST } from '@/app/api/profile/route';
import { POST as TRADE } from '@/app/api/trade/route';
import { GET as WATCHLIST } from '@/app/api/watchlist/route';
import { GET as WHY } from '@/app/api/watchlist/why/route';
import type { TextRef } from '@/lib/domain/types';
import { localizeCappedBy, overrideCapRefusal } from '@/lib/rules/risk';
import { ServiceError, issueText } from '@/lib/services/errors';
import { requestLocale, respond } from '@/lib/services/http';
import { getLayout, validateLayout } from '@/lib/services/layout';
import { getPortfolio } from '@/lib/services/portfolio';
import { getProfile } from '@/lib/services/profile';
import { createRule, evaluateRules, testTrigger, validateRule } from '@/lib/services/rules-engine';
import { SERVICE_TEXT, renderText, type ServiceParams, type ServiceTextKey } from '@/lib/services/text';
import { buildStatus, explainSymbol, getWatchlist } from '@/lib/services/watchlist';
import type { UniverseEntry } from '@/lib/domain/types';
import { containsNeverWord } from '@/lib/watchlist/reasons';
import { answers, freshWorld, market, sourced } from './helpers';

vi.mock('@/lib/services/quotes', async (original) => (await import('./market-stub')).quotesMock(await original()));
vi.mock('@/lib/sources/daily-signals', async (original) => {
    const real = await original<typeof import('@/lib/sources/daily-signals')>();
    const { passing, sourced: stub, NOW } = await import('./market-stub');
    const daily = async (entries: UniverseEntry[]) => ({ date: real.marketDate(), collectedAt: NOW, stale: false, fxUsdCad: stub(1.42, { source: 'Bank of Canada' }), signals: entries.map(passing) });
    return { ...real, loadDailySignals: vi.fn(daily), refreshDailySignals: vi.fn(daily) };
});

beforeEach(() => freshWorld());

const NBSP = ' ';
const ref = (key: string, params: Record<string, unknown> = {}): TextRef => ({ key, params: params as TextRef['params'] });
const french = (url: string, init: { method?: string; body?: unknown } = {}) => new NextRequest(url, {
    method: init.method ?? 'GET',
    headers: { cookie: 'NEXT_LOCALE=fr' },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
});
const check = { key: 'filter.volatility', params: { value: 0.5, limit: 0.35, pass: false, risk: 'Medium' } };

// Sample values for every sentence of the services catalog
const SAMPLES: { [K in ServiceTextKey]: Array<ServiceParams<K>> } = {
    'svc.no_profile': [{}],
    'svc.not_in_universe': [{ symbol: 'NOPE' }],
    'svc.reference_value': [{ name: 'Gold (spot)' }],
    'svc.joined': [{ items: [ref('svc.rule.price_trigger'), 'plain text'] }],
    'svc.http.bad_json': [{}],
    'svc.http.server_error': [{}],
    'svc.http.too_many': [{}],
    'svc.http.give_symbol': [{}],
    'svc.validation': [
        { path: 'side', problem: 'not_accepted', detail: 'Invalid option', limit: null },
        { path: 'rule.text', problem: 'too_short', detail: 'Too small', limit: 1 },
        { path: 'amountCad', problem: 'too_small_strict', detail: 'Too small', limit: 0 },
        { path: 'symbol', problem: 'required', detail: 'Invalid input: expected string, received undefined', limit: null },
    ],
    'svc.watchlist.failed': [{}],
    'svc.watchlist.already_today': [{ date: '2026-11-15' }],
    'svc.watchlist.in_progress': [{}],
    'svc.watchlist.no_run': [{}],
    'svc.watchlist.not_candidate': [{ symbol: 'ZZZ', count: 1234 }],
    'svc.watchlist.reference_card': [{ symbol: 'GOLD' }],
    'svc.watchlist.not_selected': [{ symbol: 'MSFT', total: 58.7, picks: 10, level: 'Intermediate', maxPerSector: 2, margin: 5, minDays: 7 }],
    'svc.watchlist.kept_out': [{ symbol: 'MSFT', total: 58.7, picks: 10, kept: [ref('svc.watchlist.kept_seed', { symbol: 'AAPL', total: 52 }), ref('svc.watchlist.kept_min_stay', { symbol: 'RY.TO', total: 55.1, days: 2, minDays: 7 })] }],
    'svc.watchlist.kept_seed': [{ symbol: 'AAPL', total: 52 }],
    'svc.watchlist.kept_min_stay': [{ symbol: 'RY.TO', total: 55.1, days: 1, minDays: 7 }, { symbol: 'RY.TO', total: 55.1, days: 3, minDays: 7 }],
    'svc.watchlist.kept_margin': [{ symbol: 'ENB', total: 55.5, margin: 5, gap: 3.2 }],
    'svc.watchlist.kept_incumbent': [{ symbol: 'ENB', total: 55.5, margin: 5, minDays: 7 }],
    'svc.trade.not_in_universe': [{ symbol: 'NOPE' }],
    'svc.trade.amount_or_quantity': [{}],
    'svc.trade.no_price': [{ symbol: 'AAPL' }],
    'svc.trade.no_conversion': [{ symbol: 'AAPL', currency: 'EUR' }, { symbol: 'AAPL', currency: null }],
    'svc.trade.too_small': [{ amount: 0.01, unit: 1500.5 }],
    'svc.trade.cash_short': [{ cash: 9858, need: 14200 }],
    'svc.trade.position_short': [{ symbol: 'AAPL', held: 1.5, quantity: 2 }],
    'svc.trade.conflict': [{ symbol: 'AAPL', level: 'Novice', risk: 'Low', conflicts: [check] }, { symbol: 'AAPL', level: 'Expert', risk: 'High', conflicts: [check, check] }],
    'svc.trade.reason_default': [{ side: 'buy', origin: 'card' }, { side: 'sell', origin: 'rule' }, { side: 'buy', origin: 'agent' }],
    'svc.trade.reason': [{ base: ref('svc.trade.reason_default', { side: 'buy', origin: 'card' }), conflicts: [check] }, { base: ref('svc.trade.reason_default', { side: 'sell', origin: 'card' }), conflicts: [] }],
    'svc.portfolio.no_trade': [{}],
    'svc.portfolio.history_note': [{ sources: 'TMX Money', withoutCloses: ['BTC'] }, { sources: null, withoutCloses: [] }],
    'svc.portfolio.value_note': [
        { priceSources: ['Finnhub'], fxValue: 1.4234, fxSource: 'Bank of Canada', fxAsOf: '2026-11-13', unpriced: ['BTC'] },
        { priceSources: [], fxValue: null, fxSource: null, fxAsOf: null, unpriced: [] },
    ],
    'svc.portfolio.group': [{ group: 'ETF' }, { group: 'Crypto' }, { group: 'Other' }, { group: 'Energy' }],
    'svc.stats.symbols_needed': [{ metric: 'correlation', count: 2 }, { metric: 'return', count: 1 }],
    'svc.stats.no_closes': [{ symbol: 'AAPL' }],
    'svc.xray.bad_amount': [{}],
    'svc.xray.not_held': [{ symbol: 'AAPL' }],
    'svc.xray.reduce_too_large': [{ symbol: 'AAPL', held: 1500.5, amount: 2000 }],
    'svc.rule.price_trigger': [{}],
    'svc.rule.change_trigger': [{}],
    'svc.rule.amount_or_quantity': [{}],
    'svc.rule.no_price': [{ symbol: 'AAPL' }],
    'svc.rule.no_conversion': [{ symbol: 'AAPL' }],
    'svc.rule.cash_short': [{ cash: 10000, cost: 14200 }],
    'svc.rule.nothing_to_reduce': [{ symbol: 'AAPL' }],
    'svc.rule.position_short': [{ symbol: 'AAPL', held: 1, quantity: 3 }],
    'svc.rule.unknown_id': [{ id: 'rule_123' }],
    'svc.rule.spent': [{}],
    'svc.rule.fact_price': [
        { price: 98.2, value: 100, currency: 'USD', hit: true, relation: 'below' }, { price: 101, value: 100, currency: 'USD', hit: false, relation: 'below' },
        { price: 101, value: 100, currency: 'CAD', hit: true, relation: 'above' },
    ],
    'svc.rule.fact_change': [{ change: -5.5, value: -5, hit: true, relation: 'below' }, { change: 1.25, value: 2, hit: false, relation: 'above' }],
    'svc.rule.fact_no_change': [{}],
    'svc.rule.trade_reason': [{ ruleId: 'rule_1', fact: ref('svc.rule.fact_price', { price: 98.2, value: 100, currency: 'USD', hit: true, relation: 'below' }) }],
    'svc.rule.note': [{ note: 'fired_once' }, { note: 'fired_today' }, { note: 'no_price' }],
    'svc.rule.not_simulated': [{ fact: ref('svc.rule.fact_no_change'), why: ref('svc.rule.not_recorded') }],
    'svc.rule.not_recorded': [{}],
    'svc.rule.needs_wording': [{}],
    'svc.layout.widget_title': ['total_value', 'performance', 'holdings', 'sector_allocation', 'investment_rules'].map((id) => ({ id })),
    'svc.layout.not_a_list': [{}],
    'svc.layout.unknown': [{ ids: ['news'] }],
    'svc.layout.repeated': [{ ids: ['holdings'] }],
    'svc.layout.fixed': [{ ids: ['total_value'] }],
    'svc.theme': [{ theme: 'AI' }, { theme: 'clean energy' }, { theme: 'dividends' }, { theme: 'ESG' }],
    'svc.sector': [{ sector: 'Health Care' }, { sector: 'Information Technology' }],
};
const all = (Object.keys(SAMPLES) as ServiceTextKey[]).flatMap((key) => (SAMPLES[key] as Array<Record<string, unknown>>).map((params) => ({ key, params })));
// Short labels that are the same in both languages (an identifier, a theme name)
const SAME = new Set(['svc.theme:{"theme":"ESG"}']);

describe('services catalog: every sentence in both languages', () => {
    it('has samples for every key', () => {
        expect(Object.keys(SAMPLES).sort()).toEqual(Object.keys(SERVICE_TEXT).sort());
    });

    it.each(all.map((item) => [item.key, JSON.stringify(item.params), item] as const))('%s %s', (key, json, { params }) => {
        const en = renderText(ref(key, params), 'en');
        const fr = renderText(ref(key, params), 'fr');
        expect(en.trim().length).toBeGreaterThan(0);
        expect(fr.trim().length).toBeGreaterThan(0);
        if (!SAME.has(`${key}:${json}`)) expect(fr).not.toBe(en);
        expect(containsNeverWord(en), en).toBe(false);
        expect(containsNeverWord(fr), fr).toBe(false);
        expect(fr).not.toMatch(/ [:%]/);
        expect(fr).not.toMatch(/\bundefined\b|\bnull\b|NaN/);
        expect(en).not.toMatch(/\bundefined\b|\bnull\b|NaN/);
    });

    it('writes French amounts with Intl: decimal comma, $ after the amount', () => {
        expect(renderText(ref('svc.trade.cash_short', { cash: 9858, need: 14200 }), 'fr'))
            .toBe(`Les liquidités simulées s’élèvent à 9${NBSP}858,00${NBSP}$; cette acquisition simulée nécessite 14${NBSP}200,00${NBSP}$.`);
        expect(renderText(ref('svc.trade.cash_short', { cash: 9858, need: 14200 }), 'en')).toBe('Simulated cash is 9,858.00 CAD; this purchase needs 14,200.00 CAD.');
        expect(renderText(ref('svc.rule.fact_price', { price: 98.2, value: 100, currency: 'USD', hit: true, relation: 'below' }), 'fr'))
            .toBe('le cours de 98,20 USD était inférieur à 100,00 USD');
    });
});

describe('ServiceError and the HTTP layer', () => {
    it('keeps the English message and gives it in French on demand', () => {
        const error = new ServiceError(404, ref('svc.not_in_universe', { symbol: 'NOPE' }));
        expect(error.message).toBe("NOPE is not in the app's list of assets.");
        expect(error.messageIn('fr')).toBe('NOPE ne figure pas dans la liste d’actifs de l’application.');
        expect(new ServiceError(400, 'given as text').messageIn('fr')).toBe('given as text');
    });

    it('reads the language from the cookie, then Accept-Language, else English', async () => {
        expect(await requestLocale(new NextRequest('http://localhost/api', { headers: { cookie: 'a=1; NEXT_LOCALE=fr' } }))).toBe('fr');
        expect(await requestLocale(new NextRequest('http://localhost/api', { headers: { 'accept-language': 'fr-CA,fr;q=0.9,en;q=0.8' } }))).toBe('fr');
        expect(await requestLocale(new NextRequest('http://localhost/api', { headers: { cookie: 'NEXT_LOCALE=en', 'accept-language': 'fr-CA' } }))).toBe('en');
        expect(await requestLocale(new NextRequest('http://localhost/api', { headers: { 'accept-language': 'pl,ar' } }))).toBe('en');
        expect(await requestLocale()).toBe('en');
    });

    it('answers a refusal, a validation problem and bad JSON in the request language', async () => {
        const req = french('http://localhost/api');
        const refused = await respond(async () => { throw new ServiceError(409, ref('svc.no_profile')); }, req);
        expect(await refused.json()).toEqual({ error: 'Aucun profil n’existe encore. Remplissez d’abord le questionnaire de profil.' });
        const invalid = await respond(async () => z.object({ side: z.enum(['a', 'b']) }).parse({ side: 'c' }), req);
        expect(await invalid.json()).toEqual({ error: `side${NBSP}: ne fait pas partie des valeurs acceptées` });
        const json = await respond(async () => JSON.parse('{'), req);
        expect(await json.json()).toEqual({ error: 'Le corps de la requête n’est pas un JSON valide.' });
        expect(await (await respond(async () => JSON.parse('{'))).json()).toEqual({ error: 'The request body is not valid JSON.' });
    });

    it('words zod problems in French from their code', () => {
        const schema = z.object({ text: z.string().min(1, 'the rule needs its wording'), amount: z.number().positive(), list: z.array(z.string()).max(1), name: z.string() });
        const issues = schema.safeParse({ text: '', amount: -1, list: ['a', 'b'] }).error!.issues;
        expect(issues.map((issue) => issueText(issue, 'rule', 'fr'))).toEqual([
            `text${NBSP}: la règle doit avoir un libellé`,
            `amount${NBSP}: doit être supérieur à 0`,
            `list${NBSP}: au plus 1 élément(s)`,
            `name${NBSP}: valeur requise`,
        ]);
        expect(issueText(issues[0], 'rule')).toBe('text: the rule needs its wording');
    });
});

describe('routes in French', () => {
    it('POST /api/trade: the conflict message and details in French, the trade reason in French with its reference', async () => {
        await POST(new NextRequest('http://localhost/api', { method: 'POST', body: JSON.stringify({ answers: answers() }) }));
        market.signals.AAPL = { volatility1y: sourced(0.5, { source: 'derived' }) };
        const conflict = await TRADE(french('http://localhost/api/trade', { method: 'POST', body: { symbol: 'AAPL', side: 'buy', amountCad: 142 } }));
        expect(conflict.status).toBe(409);
        const body = await conflict.json();
        expect(body.message).toBe(`AAPL ne satisfait pas à 1 des filtres de votre profil (Intermédiaire, risque Moyen)${NBSP}: volatilité de 50,0${NBSP}%, au-dessus du plafond de 35,0${NBSP}% pour un profil de risque Moyen. Rien n’a été simulé. Vous pouvez tout de même poursuivre dans la simulation.`);
        expect(body.conflicts[0].detail).toBe(`volatilité de 50,0${NBSP}%, au-dessus du plafond de 35,0${NBSP}% pour un profil de risque Moyen`);
        const done = await (await TRADE(french('http://localhost/api/trade', { method: 'POST', body: { symbol: 'AAPL', side: 'buy', amountCad: 142, acknowledgeConflict: true } }))).json();
        expect(done.trade.reason).toBe(`acquisition simulée depuis la fiche; conflit de profil consigné${NBSP}: volatilité de 50,0${NBSP}%, au-dessus du plafond de 35,0${NBSP}% pour un profil de risque Moyen`);
        // The portfolio and the decision log show it in the language asked for, whatever language it was written in
        expect((await getPortfolio('en')).portfolio.trades[0].reason).toBe('simulated purchase from the card; profile conflict logged: volatility 50.0% is above the 35.0% cap for Medium risk');
        const rows = await (await DECISIONS(new NextRequest('http://localhost/api/decisions?kind=simulated_trade'))).json();
        expect(rows.decisions[0].payload.trade.reason).toBe('simulated purchase from the card; profile conflict logged: volatility 50.0% is above the 35.0% cap for Medium risk');
        const refused = await TRADE(french('http://localhost/api/trade', { method: 'POST', body: { symbol: 'NOPE', side: 'buy', amountCad: 5 } }));
        expect(await refused.json()).toEqual({ error: 'NOPE ne figure pas dans la liste d’actifs de l’application et ne peut donc pas être simulé.' });
    });

    it('PATCH /api/profile: the cap refusal in French; GET gives the cap wording in French', async () => {
        await POST(new NextRequest('http://localhost/api', { method: 'POST', body: JSON.stringify({ answers: { ...answers(), drop20: 'sell', investingGoal: 'trading', echeance: '5+ yrs', selfRating: 'high' } }) }));
        const refused = await PATCH(french('http://localhost/api/profile', { method: 'PATCH', body: { risk: 'High' } }));
        expect(refused.status).toBe(400);
        const { error } = await refused.json();
        expect(error).toBe(`Le profil de risque Élevé n’est pas disponible${NBSP}: vous avez répondu «${NBSP}réduire ma position${NBSP}» à la question sur une baisse de 20${NBSP}%, ce qui limite le profil de risque à Moyen.`);
        expect(containsNeverWord(error)).toBe(false);
        const stored = (await getProfile('en'))!;
        expect(stored.riskResult.cappedBy).toBe('"Sell" on the drop question can never give High');
        expect((await getProfile('fr'))!.riskResult.cappedBy).toBe(`«${NBSP}Réduire ma position${NBSP}» à la question sur une baisse de 20${NBSP}% ne donne jamais un profil de risque Élevé`);
        expect(localizeCappedBy('not a cap', 'fr')).toBe('not a cap');
        expect(overrideCapRefusal('High', { ...answers(), drop20: 'sell' })).toBe('High is not available: you answered "reduce my position" to the 20% drop question, which limits the risk profile to Medium.');
    });

    it('the watchlist: computed in English, served in French by re-rendering (and the reverse)', async () => {
        await getWatchlist('en');
        await buildStatus().promise;
        const english = await getWatchlist('en');
        const viaRoute = await (await WATCHLIST(french('http://localhost/api/watchlist'))).json();
        const frenchView = await getWatchlist('fr');
        expect(english.result!.locale).toBe('en');
        expect(frenchView.result!.locale).toBe('fr');
        expect(viaRoute.result.picks.map((pick: { symbol: string }) => pick.symbol)).toEqual(english.result!.picks.map((pick) => pick.symbol));
        expect(viaRoute.result.picks[0].reason.text).toBe(frenchView.result!.picks[0].reason!.text);
        for (const pick of frenchView.result!.picks) {
            expect(pick.total).toBe(english.result!.picks.find((p) => p.symbol === pick.symbol)!.total);
            for (const factor of Object.values(pick.factors)) expect(factor.detail).not.toMatch(/\b(is|was|the)\b/);
        }
        const aapl = frenchView.result!.picks.find((pick) => pick.symbol === 'AAPL')!;
        expect(aapl.reason!.text).toBe('Dans le secteur Technologies de l’information, que vous avez choisi');
        expect(english.result!.picks.find((pick) => pick.symbol === 'AAPL')!.reason!.text).toBe('In Information Technology, a sector you picked');

        const why = await (await WHY(french('http://localhost/api/watchlist/why?symbol=BTC'))).json();
        expect(why.listed).toBe(false);
        expect(why.rejected.map((check: { detail: string }) => check.detail)).toContain(`les cryptomonnaies ne sont retenues que pour un profil de risque Élevé; le profil de risque est Moyen`);
        // A listed pick comes with its filter checks too, same field as for a candidate, in the request language
        const listed = await (await WHY(french('http://localhost/api/watchlist/why?symbol=AAPL'))).json();
        expect(listed).toMatchObject({ listed: true, pick: { symbol: 'AAPL' }, candidate: { symbol: 'AAPL', passed: true } });
        expect(listed.candidate.filters.find((check: { filter: string }) => check.filter === 'volatility')).toMatchObject({ pass: true, detail: expect.stringContaining('volatilité de 25,0') });
        expect((await explainSymbol('ZZZZ', 'fr')).note).toMatch(/^ZZZZ ne faisait pas partie des \d+ candidats de ce calcul/);
        const missing = await WHY(french('http://localhost/api/watchlist/why'));
        expect(await missing.json()).toEqual({ error: 'Indiquez un symbole.' });
    });

    it('rules: validation errors, trigger facts and check notes in French', async () => {
        const rule = { text: 'sous 100', symbol: 'AAPL', trigger: { type: 'price_below', value: 100 }, action: { side: 'buy', amountCad: 20000 }, once: true };
        const checked = await validateRule(rule, 'fr');
        expect(checked).toMatchObject({ ok: false, errors: [`Les liquidités simulées s’élèvent à 10${NBSP}000,00${NBSP}$; cette règle nécessiterait 20${NBSP}000,00${NBSP}$ au dernier cours.`] });
        await expect(createRule(rule)).rejects.toMatchObject({ status: 400, message: 'Simulated cash is 10000.00 CAD; this rule would need 20000.00 CAD at the last price.' });
        const saved = await createRule({ ...rule, action: { side: 'buy', amountCad: 142 }, trigger: { type: 'price_below', value: 120 } });
        const fact = testTrigger(saved, sourced(100, { currency: 'USD' }), undefined, 'fr');
        expect(fact).toMatchObject({ hit: true, fact: 'le cours de 100,00 USD était inférieur à 120,00 USD' });
        const { fired, checks } = await evaluateRules('fr');
        expect(fired[0].reason).toBe(`règle ${saved.id}${NBSP}: le cours de 100,00 USD était inférieur à 120,00 USD`);
        expect(checks[0].note).toBe('le cours de 100,00 USD était inférieur à 120,00 USD');
        expect((await evaluateRules('fr')).checks).toEqual([]);   // fired once, now paused
        expect((await getPortfolio('en')).portfolio.trades[0].reason).toBe(`rule ${saved.id}: price 100.00 USD was below 120.00 USD`);
    });

    it('layout and portfolio: titles, problems and notes in French', async () => {
        expect((await getLayout('fr')).library.map((widget) => widget.title)).toEqual(['Valeur totale (simulée)', 'Graphique de rendement', 'Positions détenues', 'Répartition par secteur', 'Radiographie du portefeuille', 'Règles de placement (simulées)']);
        expect((await getLayout('en')).library[0].title).toBe('Total value (simulated)');
        expect(validateLayout(['holdings', 'holdings'], 'fr')).toEqual(['Indiqués plus d’une fois : holdings.'.replace(' :', `${NBSP}:`), `Les modules fixes ne peuvent pas être retirés${NBSP}: Valeur totale (simulée).`]);
        expect(validateLayout(['holdings'])).toEqual(['Fixed widgets cannot be removed: Total value (simulated).']);
        expect((await getPortfolio('fr')).historyNote).toBe(`Aucune opération simulée pour l’instant${NBSP}: la valeur correspond au montant de départ.`);
    });
});
