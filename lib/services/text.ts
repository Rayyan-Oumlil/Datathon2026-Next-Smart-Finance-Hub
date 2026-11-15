// Every sentence the services write for the user, in English and French: refusals and errors returned by the API,
// notes of the simulated portfolio, the reasons and notes of simulated trades and rules, the titles of the widgets.
// The rendering machinery is lib/watchlist/text.ts; importing this module also registers the watchlist and rules
// catalogs, so any stored TextRef can be rendered from here (renderText).

import type { ZodIssue } from 'zod';
import '@/lib/rules/text';
import { defineCatalog, renderOr, renderText, sayer, sub, subList, toLocale, type Fmt, type Locale, type ParamsOf, type TextParam, type TextRef } from '@/lib/watchlist/text';

export { renderOr, renderText, toLocale, type Locale, type TextRef };

const ORIGIN_FR: Record<string, string> = { card: 'la fiche', rule: 'la règle', agent: 'l’assistant' };
const METRIC_FR: Record<string, string> = { return: 'rendement', drawdown: 'baisse maximale', correlation: 'corrélation' };
const WIDGET_FR: Record<string, string> = {
    total_value: 'Valeur totale (simulée)',
    performance: 'Graphique de rendement',
    holdings: 'Positions détenues',
    sector_allocation: 'Répartition par secteur',
    investment_rules: 'Règles de placement (simulées)',
    xray: 'Radiographie du portefeuille',
    overview_watchlist: 'Liste de suivi intelligente (Aperçu)',
    overview_pulse: 'Pouls du marché (Aperçu)',
    overview_leaders: 'Meneurs du marché (Aperçu)',
    overview_heatmap: 'Carte thermique (Aperçu)',
    overview_quotes: 'Cours du marché (Aperçu)',
    overview_news: 'Actualités (Aperçu)',
};
const WIDGET_EN: Record<string, string> = {
    total_value: 'Total value (simulated)',
    performance: 'Performance chart',
    holdings: 'Holdings',
    sector_allocation: 'Sector allocation',
    investment_rules: 'Investment rules (simulated)',
    xray: 'Portfolio X-ray',
    overview_watchlist: 'Smart watchlist (Overview)',
    overview_pulse: 'Market pulse (Overview)',
    overview_leaders: 'Market leaders (Overview)',
    overview_heatmap: 'Heatmap (Overview)',
    overview_quotes: 'Market quotes (Overview)',
    overview_news: 'News stories (Overview)',
};
const own = (table: Record<string, string>, key: string) => (Object.prototype.hasOwnProperty.call(table, key) ? table[key] : key);
/** A quantity of units, up to 6 decimals (fractional units exist in the simulation). */
const units = (value: number, f: Fmt) => f.num(value, undefined, 6);
/** Plain 2-decimal amounts as the English sentences always wrote them ("10000.00 CAD"); French uses its currency format. */
const fixedCad = (value: number, f: Fmt) => (f.locale === 'fr' ? f.cad(value) : `${value.toFixed(2)} CAD`);
const fixed2 = (value: number, f: Fmt) => (f.locale === 'fr' ? f.num(value, 2) : value.toFixed(2));
const pct2 = (value: number, f: Fmt) => (f.locale === 'fr' ? f.pctOf(value, 2) : `${value.toFixed(2)}%`);

type Symbol = { symbol: string };
type ValueNote = { priceSources: string[]; fxValue: number | null; fxSource: string | null; fxAsOf: string | null; unpriced: string[] };
type Trigger = { hit: boolean; relation: 'below' | 'above' };
type NotSelected = { symbol: string; total: number; picks: number; level: string; maxPerSector: number; margin: number; minDays: number };
type Kept = { symbol: string; total: number };

export const SERVICE_TEXT = defineCatalog({
    // ---- shared
    'svc.no_profile': {
        en: () => 'No profile exists yet. Complete onboarding first.',
        fr: () => 'Aucun profil n’existe encore. Remplissez d’abord le questionnaire de profil.',
    },
    'svc.not_in_universe': {
        en: (p: Symbol) => `${p.symbol} is not in the app's list of assets.`,
        fr: (p: Symbol) => `${p.symbol} ne figure pas dans la liste d’actifs de l’application.`,
    },
    'svc.reference_value': {
        en: (p: { name: string }) => `${p.name} is a reference value here and cannot be traded in the simulation.`,
        fr: (p: { name: string }) => `${p.name} est une valeur de référence ici et ne peut pas faire l’objet d’une opération simulée.`,
    },
    /** Several messages shown together (validation errors), each a TextRef or plain text. */
    'svc.joined': {
        en: (p: { items: TextParam }) => subList(p.items, 'en', ' '),
        fr: (p: { items: TextParam }) => subList(p.items, 'fr', ' '),
    },

    // ---- HTTP layer
    'svc.http.bad_json': {
        en: () => 'The request body is not valid JSON.',
        fr: () => 'Le corps de la requête n’est pas un JSON valide.',
    },
    'svc.http.server_error': {
        en: () => 'The server could not complete the request.',
        fr: () => 'Le serveur n’a pas pu traiter la requête.',
    },
    'svc.http.too_many': {
        en: () => 'Too many requests',
        fr: () => 'Trop de requêtes',
    },
    'svc.http.reset_refused': {
        en: () => 'Only the visitor can reset the session, from the app.',
        fr: () => 'Seul le visiteur peut réinitialiser la session, depuis l’application.',
    },
    'svc.http.give_symbol': {
        en: () => 'Give a symbol.',
        fr: () => 'Indiquez un symbole.',
    },
    // One validation problem: the field path, then what is wrong with it
    'svc.validation': {
        en: (p: { path: string; problem: string; detail: string | null }) => `${p.path}: ${p.problem === 'raw' ? p.detail : VALIDATION_EN[p.problem] ?? p.detail}`,
        fr: (p: { path: string; problem: string; detail: string | null; limit: number | null }, f) => `${p.path} : ${validationFr(p, f)}`,
    },

    // ---- watchlist service
    'svc.watchlist.failed': {
        en: () => 'The watchlist could not be computed. Try again in a minute.',
        fr: () => 'La liste de suivi n’a pas pu être calculée. Réessayez dans une minute.',
    },
    'svc.watchlist.already_today': {
        en: (p: { date: string }) => `The list is recomputed once a day: today's run (signals of ${p.date}) for the current profile, holdings and rules already exists.`,
        fr: (p: { date: string }) => `La liste est recalculée une fois par jour : le calcul d’aujourd’hui (signaux du ${p.date}) existe déjà pour le profil, les positions et les règles actuels.`,
    },
    'svc.watchlist.in_progress': {
        en: () => 'A computation is already in progress.',
        fr: () => 'Un calcul est déjà en cours.',
    },
    'svc.watchlist.no_run': {
        en: () => 'No watchlist has been computed yet.',
        fr: () => 'Aucune liste de suivi n’a encore été calculée.',
    },
    'svc.watchlist.not_candidate': {
        en: (p: { symbol: string; count: number }) => `${p.symbol} was not among the ${p.count} candidates of this run: it is outside the markets, sectors, niches, themes and brands of the profile.`,
        fr: (p: { symbol: string; count: number }, f) => `${p.symbol} ne faisait pas partie des ${f.num(p.count)} candidats de ce calcul : il se trouve hors des marchés, secteurs, créneaux, thèmes et marques du profil.`,
    },
    'svc.watchlist.reference_card': {
        en: (p: Symbol) => `${p.symbol} is shown as a reference card and is not ranked.`,
        fr: (p: Symbol) => `${p.symbol} est présenté sous forme de fiche de référence et n’est pas classé.`,
    },
    // Passed every filter, not selected, and the stored run cannot name the one rule that kept it out: the limits
    'svc.watchlist.not_selected': {
        en: (p: NotSelected, f) =>
            `${p.symbol} passed every filter with a total of ${f.num(p.total, undefined, 1)}, and was not selected: other picks ranked ahead of it. The list holds ${p.picks} picks (${p.level}), at most ${p.maxPerSector} per sector; a listed pick keeps its place for at least ${p.minDays} days, and after that a newcomer takes its place only with a total more than ${f.num(p.margin, undefined, 1)} points higher.`,
        fr: (p: NotSelected, f) =>
            `${p.symbol} a satisfait à tous les filtres avec un pointage total de ${f.num(p.total, undefined, 1)}, mais n’a pas été retenu\u00a0: d’autres titres étaient classés devant lui. La liste compte ${p.picks} titres (niveau ${f.level(p.level)}), au plus ${p.maxPerSector} par secteur; un titre déjà inscrit garde sa place au moins ${p.minDays} jours, puis un nouveau venu ne le remplace qu’avec un pointage total supérieur de plus de ${f.num(p.margin, undefined, 1)} points.`,
    },
    // Passed every filter, the list was full, and picks with a total no higher than its own kept their places
    'svc.watchlist.kept_out': {
        en: (p: { symbol: string; total: number; picks: number; kept: TextParam }, f) =>
            `${p.symbol} passed every filter with a total of ${f.num(p.total, undefined, 1)}, and was not selected: the list was full (${p.picks} picks) and these picks with a total no higher kept their places: ${subList(p.kept, 'en')}.`,
        fr: (p: { symbol: string; total: number; picks: number; kept: TextParam }, f) =>
            `${p.symbol} a satisfait à tous les filtres avec un pointage total de ${f.num(p.total, undefined, 1)}, mais n’a pas été retenu\u00a0: la liste était complète (${p.picks} titres) et ces titres, au pointage total égal ou inférieur, ont gardé leur place\u00a0: ${subList(p.kept, 'fr')}.`,
    },
    'svc.watchlist.kept_seed': {
        en: (p: Kept, f) => `${p.symbol} (total ${f.num(p.total, undefined, 1)}) is one of the profile's brands, kept while it passes the filters`,
        fr: (p: Kept, f) => `${p.symbol} (pointage total de ${f.num(p.total, undefined, 1)}) fait partie des marques du profil et reste inscrit tant qu’il satisfait aux filtres`,
    },
    'svc.watchlist.kept_min_stay': {
        en: (p: Kept & { days: number; minDays: number }, f) =>
            `${p.symbol} (total ${f.num(p.total, undefined, 1)}) had been listed for ${p.days} ${p.days === 1 ? 'day' : 'days'}, inside the ${p.minDays}-day minimum stay`,
        fr: (p: Kept & { days: number; minDays: number }, f) =>
            `${p.symbol} (pointage total de ${f.num(p.total, undefined, 1)}) était inscrit depuis ${p.days} ${p.days > 1 ? 'jours' : 'jour'}, à l’intérieur de la durée minimale de ${p.minDays} jours`,
    },
    'svc.watchlist.kept_margin': {
        en: (p: Kept & { margin: number; gap: number }, f) =>
            `${p.symbol} (total ${f.num(p.total, undefined, 1)}) was already listed, and a newcomer takes a listed pick's place only with a total more than ${f.num(p.margin, undefined, 1)} points higher (the difference here is ${f.num(p.gap, undefined, 1)} points)`,
        fr: (p: Kept & { margin: number; gap: number }, f) =>
            `${p.symbol} (pointage total de ${f.num(p.total, undefined, 1)}) était déjà inscrit, et un nouveau venu ne remplace un titre inscrit qu’avec un pointage total supérieur de plus de ${f.num(p.margin, undefined, 1)} points (l’écart est ici de ${f.num(p.gap, undefined, 1)} point${p.gap >= 2 ? 's' : ''})`,
    },
    // An incumbent of a run logged before the starting state was stored: which of the two rules held it is unknown
    'svc.watchlist.kept_incumbent': {
        en: (p: Kept & { margin: number; minDays: number }, f) =>
            `${p.symbol} (total ${f.num(p.total, undefined, 1)}) was already listed: a listed pick keeps its place for at least ${p.minDays} days, and after that until a newcomer's total is more than ${f.num(p.margin, undefined, 1)} points higher`,
        fr: (p: Kept & { margin: number; minDays: number }, f) =>
            `${p.symbol} (pointage total de ${f.num(p.total, undefined, 1)}) était déjà inscrit\u00a0: un titre inscrit garde sa place au moins ${p.minDays} jours, puis jusqu’à ce qu’un nouveau venu obtienne un pointage total supérieur de plus de ${f.num(p.margin, undefined, 1)} points`,
    },

    // ---- simulated portfolio
    'svc.trade.not_in_universe': {
        en: (p: Symbol) => `${p.symbol} is not in the app's list of assets, so it cannot be simulated.`,
        fr: (p: Symbol) => `${p.symbol} ne figure pas dans la liste d’actifs de l’application et ne peut donc pas être simulé.`,
    },
    'svc.trade.amount_or_quantity': {
        en: () => 'Give either an amount in CAD or a quantity, above zero.',
        fr: () => 'Indiquez soit un montant en dollars canadiens, soit une quantité, supérieur à zéro.',
    },
    'svc.trade.no_price': {
        en: (p: Symbol) => `No price with a source is available for ${p.symbol} right now, so nothing was simulated.`,
        fr: (p: Symbol) => `Aucun prix accompagné de sa source n’est disponible pour ${p.symbol} en ce moment : rien n’a été simulé.`,
    },
    'svc.trade.no_conversion': {
        en: (p: { symbol: string; currency: string | null }) => `The ${p.currency ?? 'unknown currency'} price of ${p.symbol} cannot be converted to CAD right now, so nothing was simulated.`,
        fr: (p: { symbol: string; currency: string | null }) => `Le prix de ${p.symbol} en ${p.currency ?? 'devise inconnue'} ne peut pas être converti en dollars canadiens en ce moment : rien n’a été simulé.`,
    },
    'svc.trade.too_small': {
        en: (p: { amount: number; unit: number }, f) => `${f.num(p.amount, 2)} CAD is too small for one unit at ${f.num(p.unit, 2)} CAD.`,
        fr: (p: { amount: number; unit: number }, f) => `Un montant de ${f.cad(p.amount)} ne suffit pas pour une unité à ${f.cad(p.unit)}.`,
    },
    'svc.trade.cash_short': {
        en: (p: { cash: number; need: number }, f) => `Simulated cash is ${f.num(p.cash, 2)} CAD; this purchase needs ${f.num(p.need, 2)} CAD.`,
        fr: (p: { cash: number; need: number }, f) => `Les liquidités simulées s’élèvent à ${f.cad(p.cash)}; cette acquisition simulée nécessite ${f.cad(p.need)}.`,
    },
    'svc.trade.position_short': {
        en: (p: { symbol: string; held: number; quantity: number }, f) => `The simulated position in ${p.symbol} is ${units(p.held, f)} units; ${units(p.quantity, f)} cannot be removed.`,
        fr: (p: { symbol: string; held: number; quantity: number }, f) => `La position simulée en ${p.symbol} est de ${units(p.held, f)} unités; ${units(p.quantity, f)} unités ne peuvent pas être retirées.`,
    },
    'svc.trade.conflict': {
        en: (p: { symbol: string; level: string; risk: string; conflicts: TextParam }) => {
            const n = Array.isArray(p.conflicts) ? p.conflicts.length : 1;
            return `${p.symbol} does not pass ${n} of your profile's filters (${p.level}, ${p.risk} risk): ${subList(p.conflicts, 'en')}. Nothing was simulated. You can still proceed in the simulation.`;
        },
        fr: (p: { symbol: string; level: string; risk: string; conflicts: TextParam }, f) => {
            const n = Array.isArray(p.conflicts) ? p.conflicts.length : 1;
            const filters = n === 1 ? '1 des filtres' : `${n} des filtres`;
            return `${p.symbol} ne satisfait pas à ${filters} de votre profil (${f.level(p.level)}, risque ${f.risk(p.risk)}) : ${subList(p.conflicts, 'fr')}. Rien n’a été simulé. Vous pouvez tout de même poursuivre dans la simulation.`;
        },
    },
    'svc.trade.reason_default': {
        en: (p: { side: 'buy' | 'sell'; origin: string }) => (p.side === 'buy' ? `simulated purchase from the ${p.origin}` : `simulated position reduction from the ${p.origin}`),
        fr: (p: { side: 'buy' | 'sell'; origin: string }) => (p.side === 'buy' ? `acquisition simulée depuis ${own(ORIGIN_FR, p.origin)}` : `réduction de position simulée depuis ${own(ORIGIN_FR, p.origin)}`),
    },
    // The reason stored with a trade: the given or default reason, then the profile conflicts logged with it
    'svc.trade.reason': {
        en: (p: { base: TextParam; conflicts: TextParam }) => {
            const conflicts = subList(p.conflicts, 'en');
            return `${sub(p.base, 'en')}${conflicts ? `; profile conflict logged: ${conflicts}` : ''}`;
        },
        fr: (p: { base: TextParam; conflicts: TextParam }) => {
            const conflicts = subList(p.conflicts, 'fr');
            return `${sub(p.base, 'fr')}${conflicts ? `; conflit de profil consigné : ${conflicts}` : ''}`;
        },
    },
    'svc.portfolio.no_trade': {
        en: () => 'No simulated trade yet: the value is the starting amount.',
        fr: () => 'Aucune opération simulée pour l’instant : la valeur correspond au montant de départ.',
    },
    'svc.portfolio.history_note': {
        en: (p: { sources: string | null; withoutCloses: string[] }) => [
            'First point: the starting amount, at the time of the first simulated trade. Last point: the value now.',
            p.sources !== null ? `Days in between: value at the daily close (${p.sources}), USD converted at today's Bank of Canada rate.` : 'No daily close exists yet between the first trade and now.',
            p.withoutCloses.length > 0 ? `No daily closes available for ${p.withoutCloses.join(', ')}: days holding them are left out.` : '',
        ].filter(Boolean).join(' '),
        fr: (p: { sources: string | null; withoutCloses: string[] }) => [
            'Premier point : le montant de départ, au moment de la première opération simulée. Dernier point : la valeur actuelle.',
            p.sources !== null ? `Jours intermédiaires : valeur à la clôture quotidienne (${p.sources}), USD convertis au taux du jour de la Banque du Canada.` : 'Aucune clôture quotidienne n’existe encore entre la première opération et maintenant.',
            p.withoutCloses.length > 0 ? `Aucune clôture quotidienne disponible pour ${p.withoutCloses.join(', ')} : les jours où ces titres sont détenus sont exclus.` : '',
        ].filter(Boolean).join(' '),
    },
    'svc.portfolio.value_note': {
        en: (p: ValueNote) => [
            'simulated portfolio: cash + quantity x last price of each position',
            p.priceSources.length > 0 ? `prices from ${p.priceSources.join(', ')}` : '',
            p.fxValue !== null ? `USD converted at ${p.fxValue} CAD per USD (${p.fxSource}, ${p.fxAsOf})` : '',
            p.unpriced.length > 0 ? `not included, no price available: ${p.unpriced.join(', ')}` : '',
        ].filter(Boolean).join('; '),
        fr: (p: ValueNote, f) => [
            'portefeuille simulé : liquidités + quantité × dernier cours de chaque position',
            p.priceSources.length > 0 ? `cours provenant de ${p.priceSources.join(', ')}` : '',
            p.fxValue !== null ? `USD convertis à ${f.num(p.fxValue, undefined, 6)} $ CA par USD (${p.fxSource}, ${p.fxAsOf})` : '',
            p.unpriced.length > 0 ? `non inclus, aucun prix disponible : ${p.unpriced.join(', ')}` : '',
        ].filter(Boolean).join('; '),
    },
    // The group of a position with no sector in the sector allocation
    'svc.portfolio.group': {
        en: (p: { group: string }) => p.group,
        fr: (p: { group: string }, f) => (p.group === 'ETF' ? 'FNB' : p.group === 'Crypto' ? 'Cryptomonnaie' : p.group === 'Other' ? 'Autre' : f.sector(p.group)),
    },

    // ---- portfolio statistics
    'svc.stats.symbols_needed': {
        en: (p: { metric: string; count: number }) => `${p.metric} needs ${p.count} symbol${p.count > 1 ? 's' : ''}.`,
        fr: (p: { metric: string; count: number }) => `Le calcul « ${own(METRIC_FR, p.metric)} » exige ${p.count} symbole${p.count > 1 ? 's' : ''}.`,
    },
    'svc.stats.no_closes': {
        en: (p: Symbol) => `Daily closes for ${p.symbol} are not available right now.`,
        fr: (p: Symbol) => `Les cours de clôture quotidiens de ${p.symbol} ne sont pas disponibles en ce moment.`,
    },

    // ---- portfolio X-ray
    'svc.xray.bad_amount': {
        en: () => 'The amount must be a number above zero, in CAD.',
        fr: () => 'Le montant doit être un nombre supérieur à zéro, en dollars canadiens.',
    },
    'svc.xray.not_held': {
        en: (p: Symbol) => `The simulated portfolio holds no position in ${p.symbol}, so there is nothing to reduce.`,
        fr: (p: Symbol) => `Le portefeuille simulé ne détient aucune position en ${p.symbol}; il n’y a rien à réduire.`,
    },
    'svc.xray.reduce_too_large': {
        en: (p: { symbol: string; held: number; amount: number }, f) => `The simulated position in ${p.symbol} is worth ${f.num(p.held, 2)} CAD; ${f.num(p.amount, 2)} CAD cannot be removed.`,
        fr: (p: { symbol: string; held: number; amount: number }, f) => `La position simulée en ${p.symbol} vaut ${f.cad(p.held)}; ${f.cad(p.amount)} ne peuvent pas être retirés.`,
    },

    // ---- simulated investment rules
    'svc.rule.price_trigger': {
        en: () => 'A price trigger needs a price above zero.',
        fr: () => 'Un déclencheur de cours exige un cours supérieur à zéro.',
    },
    'svc.rule.change_trigger': {
        en: () => 'A % change trigger needs a value between -100 and 100, other than 0.',
        fr: () => 'Un déclencheur de variation en % exige une valeur entre -100 et 100, autre que 0.',
    },
    'svc.rule.amount_or_quantity': {
        en: () => 'Give either an amount in CAD or a quantity.',
        fr: () => 'Indiquez soit un montant en dollars canadiens, soit une quantité.',
    },
    'svc.rule.no_price': {
        en: (p: Symbol) => `No price is available for ${p.symbol} right now, so the rule cannot be checked.`,
        fr: (p: Symbol) => `Aucun prix n’est disponible pour ${p.symbol} en ce moment : la règle ne peut pas être vérifiée.`,
    },
    'svc.rule.no_conversion': {
        en: (p: Symbol) => `The price of ${p.symbol} cannot be converted to CAD right now.`,
        fr: (p: Symbol) => `Le prix de ${p.symbol} ne peut pas être converti en dollars canadiens en ce moment.`,
    },
    'svc.rule.cash_short': {
        en: (p: { cash: number; cost: number }, f) => `Simulated cash is ${fixedCad(p.cash, f)}; this rule would need ${fixedCad(p.cost, f)} at the last price.`,
        fr: (p: { cash: number; cost: number }, f) => `Les liquidités simulées s’élèvent à ${fixedCad(p.cash, f)}; cette règle nécessiterait ${fixedCad(p.cost, f)} au dernier cours.`,
    },
    'svc.rule.nothing_to_reduce': {
        en: (p: Symbol) => `The simulated portfolio holds no ${p.symbol} to reduce.`,
        fr: (p: Symbol) => `Le portefeuille simulé ne contient aucune position en ${p.symbol} à réduire.`,
    },
    'svc.rule.position_short': {
        en: (p: { symbol: string; held: number; quantity: number }, f) => `The simulated position in ${p.symbol} is ${units(p.held, f)} units; the rule asks for ${units(p.quantity, f)}.`,
        fr: (p: { symbol: string; held: number; quantity: number }, f) => `La position simulée en ${p.symbol} est de ${units(p.held, f)} unités; la règle en demande ${units(p.quantity, f)}.`,
    },
    'svc.rule.unknown_id': {
        en: (p: { id: string }) => `No rule has the id ${p.id}.`,
        fr: (p: { id: string }) => `Aucune règle ne porte l’identifiant ${p.id}.`,
    },
    'svc.rule.spent': {
        en: () => 'This rule was set to fire once and has already fired, so it stays paused. Create a new rule to repeat it.',
        fr: () => 'Cette règle devait se déclencher une seule fois et s’est déjà déclenchée : elle reste en pause. Créez une nouvelle règle pour la répéter.',
    },
    // The fact a trigger test found: the trade's reason on a hit, the check's note otherwise
    'svc.rule.fact_price': {
        en: (p: Trigger & { price: number; value: number; currency: string }, f) =>
            `price ${fixed2(p.price, f)} ${p.currency} was ${p.hit ? '' : 'not '}${p.relation} ${fixed2(p.value, f)} ${p.currency}`.replace(/\s+/g, ' ').trim(),
        fr: (p: Trigger & { price: number; value: number; currency: string }, f) =>
            `le cours de ${fixed2(p.price, f)} ${p.currency} ${p.hit ? 'était' : 'n’était pas'} ${p.relation === 'below' ? 'inférieur' : 'supérieur'} à ${fixed2(p.value, f)} ${p.currency}`.replace(/\s+/g, ' ').trim(),
    },
    'svc.rule.fact_change': {
        en: (p: Trigger & { change: number; value: number }, f) => `change today ${pct2(p.change, f)} was ${p.hit ? '' : 'not '}${p.relation} ${pct2(p.value, f)}`,
        fr: (p: Trigger & { change: number; value: number }, f) =>
            `la variation du jour de ${pct2(p.change, f)} ${p.hit ? 'était' : 'n’était pas'} ${p.relation === 'below' ? 'inférieure' : 'supérieure'} à ${pct2(p.value, f)}`,
    },
    'svc.rule.fact_no_change': {
        en: () => 'the % change today is not available',
        fr: () => 'la variation en % du jour n’est pas disponible',
    },
    'svc.rule.trade_reason': {
        en: (p: { ruleId: string; fact: TextParam }) => `rule ${p.ruleId}: ${sub(p.fact, 'en')}`,
        fr: (p: { ruleId: string; fact: TextParam }) => `règle ${p.ruleId} : ${sub(p.fact, 'fr')}`,
    },
    'svc.rule.note': {
        en: (p: { note: 'fired_once' | 'fired_today' | 'no_price' }) => ({ fired_once: 'already fired once', fired_today: 'already fired today', no_price: 'no price available; not evaluated' })[p.note],
        fr: (p: { note: 'fired_once' | 'fired_today' | 'no_price' }) => ({ fired_once: 'déjà déclenchée une fois', fired_today: 'déjà déclenchée aujourd’hui', no_price: 'aucun prix disponible; non évaluée' })[p.note],
    },
    'svc.rule.not_simulated': {
        en: (p: { fact: TextParam; why: TextParam }) => `${sub(p.fact, 'en')}; not simulated: ${sub(p.why, 'en')}`,
        fr: (p: { fact: TextParam; why: TextParam }) => `${sub(p.fact, 'fr')}; non simulée : ${sub(p.why, 'fr')}`,
    },
    'svc.rule.not_recorded': {
        en: () => 'the trade could not be recorded',
        fr: () => 'l’opération n’a pas pu être enregistrée',
    },
    'svc.rule.needs_wording': {
        en: () => 'the rule needs its wording',
        fr: () => 'la règle doit avoir un libellé',
    },

    // ---- dashboard layout
    'svc.layout.widget_title': {
        en: (p: { id: string }) => own(WIDGET_EN, p.id),
        fr: (p: { id: string }) => own(WIDGET_FR, p.id),
    },
    'svc.layout.not_a_list': {
        en: () => 'A layout is a list of widget ids.',
        fr: () => 'Une disposition est une liste d’identifiants de modules.',
    },
    'svc.layout.unknown': {
        en: (p: { ids: string[] }) => `Not in the widget library: ${p.ids.join(', ')}.`,
        fr: (p: { ids: string[] }) => `Absents de la bibliothèque de modules : ${p.ids.join(', ')}.`,
    },
    'svc.layout.repeated': {
        en: (p: { ids: string[] }) => `Listed more than once: ${p.ids.join(', ')}.`,
        fr: (p: { ids: string[] }) => `Indiqués plus d’une fois : ${p.ids.join(', ')}.`,
    },
    'svc.layout.fixed': {
        en: (p: { ids: string[] }) => `Fixed widgets cannot be removed: ${p.ids.map((id) => own(WIDGET_EN, id)).join(', ')}.`,
        fr: (p: { ids: string[] }) => `Les modules fixes ne peuvent pas être retirés : ${p.ids.map((id) => own(WIDGET_FR, id)).join(', ')}.`,
    },

    // ---- onboarding choices
    'svc.theme': {
        en: (p: { theme: string }) => p.theme,
        fr: (p: { theme: string }, f) => f.theme(p.theme),
    },
    'svc.sector': {
        en: (p: { sector: string }) => p.sector,
        fr: (p: { sector: string }, f) => f.sector(p.sector),
    },
});

export type ServiceTextKey = keyof typeof SERVICE_TEXT;
export type ServiceParams<K extends ServiceTextKey> = ParamsOf<(typeof SERVICE_TEXT)[K]>;

/** The services sentence maker: sayService('svc.no_profile', {}, 'fr') gives { text, textRef }. */
export const sayService = sayer(SERVICE_TEXT);

/** Only the reference, for a ServiceError or a value stored with its data. */
export const serviceRef = <K extends ServiceTextKey>(key: K, params: ServiceParams<K>): TextRef => ({ key, params: params as unknown as Record<string, TextParam> });

// ---------------------------------------------------------------- validation problems (zod issues)

const VALIDATION_EN: Record<string, string> = { not_accepted: 'not one of the accepted values', required: 'a value is required' };

function validationFr(p: { problem: string; detail: string | null; limit: number | null }, f: Fmt): string {
    const limit = p.limit === null ? '' : f.num(p.limit);
    switch (p.problem) {
        case 'not_accepted': return 'ne fait pas partie des valeurs acceptées';
        case 'required': return 'valeur requise';
        case 'wrong_type': return 'type de valeur non valide';
        case 'too_short': return `au moins ${limit} caractère(s)`;
        case 'too_long': return `au plus ${limit} caractère(s)`;
        case 'too_few': return `au moins ${limit} élément(s)`;
        case 'too_many': return `au plus ${limit} élément(s)`;
        case 'too_small': return `doit être supérieur ou égal à ${limit}`;
        case 'too_small_strict': return `doit être supérieur à ${limit}`;
        case 'too_big': return `doit être inférieur ou égal à ${limit}`;
        case 'too_big_strict': return `doit être inférieur à ${limit}`;
        case 'unknown_keys': return `champs non reconnus${p.detail ? ` (${p.detail})` : ''}`;
        case 'needs_wording': return 'la règle doit avoir un libellé';
        default: return 'valeur non valide';
    }
}

const NEEDS_WORDING = 'the rule needs its wording';

/**
 * One validation problem as a catalog reference. A value outside a fixed list is not answered with the list
 * itself: zod would quote the internal option names, some of which are words the app never shows. English keeps
 * zod's own message for every other problem; French names the problem from its code.
 */
export function issueRef(issue: ZodIssue, root = 'body'): TextRef {
    const path = issue.path.join('.') || root;
    const raw = issue as ZodIssue & { origin?: string; minimum?: number | bigint; maximum?: number | bigint; inclusive?: boolean; keys?: string[] };
    let problem = 'raw';
    let limit: number | null = null;
    if (/^invalid_(enum_)?value$/.test(issue.code)) problem = 'not_accepted';
    else if (issue.message === NEEDS_WORDING) problem = 'needs_wording';
    else if (issue.code === 'invalid_type') problem = /received undefined/.test(issue.message) ? 'required' : 'wrong_type';
    else if (issue.code === 'too_small' || issue.code === 'too_big') {
        const small = issue.code === 'too_small';
        limit = Number(small ? raw.minimum : raw.maximum);
        if (raw.origin === 'string') problem = small ? 'too_short' : 'too_long';
        else if (raw.origin === 'array' || raw.origin === 'set') problem = small ? 'too_few' : 'too_many';
        else problem = `${small ? 'too_small' : 'too_big'}${raw.inclusive === false ? '_strict' : ''}`;
    } else if (issue.code === 'unrecognized_keys') problem = 'unknown_keys';
    const detail = problem === 'unknown_keys' ? (raw.keys ?? []).join(', ') : issue.message;
    return serviceRef('svc.validation', { path, problem, detail, limit });
}

/** issueRef rendered in a language. */
export const issueMessage = (issue: ZodIssue, root = 'body', locale: Locale = 'en'): string => renderText(issueRef(issue, root), locale);
