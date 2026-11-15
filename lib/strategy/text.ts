// Every sentence the strategy layer and the replay write, in English and French: validation problems, rule events,
// simulated replay orders, dropped orders, replay assumptions. Registered like the other server catalogs
// (lib/watchlist/text.ts), so renderText(textRef, locale) renders any of them.

import { defineCatalog, sayer, type Fmt, type TextParam, type TextRef } from '@/lib/watchlist/text';

type Problem = { path: string };
type Limit = Problem & { limit: number };

const KIND_EN: Record<string, string> = { price_threshold: 'price threshold', allocation_target: 'rebalancing', weight_cap: 'weight cap', drawdown_guard: 'drawdown guard', periodic_purchase: 'periodic purchase' };
const KIND_FR: Record<string, string> = { price_threshold: 'seuil de cours', allocation_target: 'rééquilibrage', weight_cap: 'plafond par titre', drawdown_guard: 'garde-fou de baisse', periodic_purchase: 'achat périodique' };
const PURPOSE_EN: Record<string, string> = {
    initial: 'starting purchase', guard_enter: 'drawdown guard', guard_exit: 'end of the drawdown guard', cap_trim: 'weight cap', cap_proceeds: 'weight cap (proceeds)',
    rebalance: 'rebalancing', periodic_purchase: 'periodic purchase', price_threshold: 'price threshold',
};
const PURPOSE_FR: Record<string, string> = {
    initial: 'achat de départ', guard_enter: 'garde-fou de baisse', guard_exit: 'fin du garde-fou de baisse', cap_trim: 'plafond par titre', cap_proceeds: 'plafond par titre (produit de la vente)',
    rebalance: 'rééquilibrage', periodic_purchase: 'achat périodique', price_threshold: 'seuil de cours',
};
const ADJUST_EN: Record<string, string> = { reduced_to_cash: 'reduced to the cash available', reduced_to_position: 'reduced to the units held', reduced_to_cap: 'reduced so the holding stays under the cap' };
const ADJUST_FR: Record<string, string> = { reduced_to_cash: 'réduit aux liquidités disponibles', reduced_to_position: 'réduit aux unités détenues', reduced_to_cap: 'réduit pour que la position reste sous le plafond' };
const pick = (table: Record<string, string>, key: string) => (Object.prototype.hasOwnProperty.call(table, key) ? table[key] : key);
const units = (value: number, f: Fmt) => f.num(value, undefined, 4);
const pts = (value: number, f: Fmt) => f.num(value, 1);

type OrderParams = {
    side: 'buy' | 'sell'; symbol: string; quantity: number; priceCad: number; valueCad: number; feeCad: number; purpose: string;
    decisionDay: string; executionDay: string; adjustment: string | null; requestedValueCad: number | null;
};
type GuardParams = { day: string; fallPct: number; thresholdPct: number; valueCad: number; peakValueCad: number; movePct: number; defensive: string };
type CapParams = { day: string; symbol: string; weightPct: number; capPct: number; others: number; proceeds: string | null };
type AllocationParams = { day: string; quarter: string; maxDriftPts: number; driftOf: string; thresholdPts: number | null };
type PurchaseParams = { day: string; amountCad: number; unit: string; n: number | null };
type PriceParams = { day: string; symbol: string; trigger: string; price: number; currency: string; threshold: number; changePct: number | null };

export const STRATEGY_TEXT = defineCatalog({
    // ---- validation: one sentence per code, with the place and the values
    'strat.invalid.unknown_field': {
        en: (p: Problem & { field: string }) => `${p.path}: the field "${p.field}" is not part of a strategy.`,
        fr: (p: Problem & { field: string }) => `${p.path} : le champ « ${p.field} » ne fait pas partie d’une stratégie.`,
    },
    'strat.invalid.required': { en: (p: Problem) => `${p.path}: a value is required.`, fr: (p: Problem) => `${p.path} : une valeur est requise.` },
    'strat.invalid.wrong_type': { en: (p: Problem) => `${p.path}: the value does not have the expected type.`, fr: (p: Problem) => `${p.path} : la valeur n’a pas le type attendu.` },
    'strat.invalid.not_accepted': { en: (p: Problem) => `${p.path}: this value is not accepted.`, fr: (p: Problem) => `${p.path} : cette valeur n’est pas acceptée.` },
    'strat.invalid.invalid': { en: (p: Problem) => `${p.path}: the value is not valid.`, fr: (p: Problem) => `${p.path} : la valeur n’est pas valide.` },
    'strat.invalid.too_small': { en: (p: Limit, f) => `${p.path}: the value must be at least ${f.num(p.limit)}.`, fr: (p: Limit, f) => `${p.path} : la valeur doit être d’au moins ${f.num(p.limit)}.` },
    'strat.invalid.too_big': { en: (p: Limit, f) => `${p.path}: the value must be at most ${f.num(p.limit)}.`, fr: (p: Limit, f) => `${p.path} : la valeur doit être d’au plus ${f.num(p.limit)}.` },
    'strat.invalid.too_few': { en: (p: Limit, f) => `${p.path}: at least ${f.num(p.limit)} item(s) are needed.`, fr: (p: Limit, f) => `${p.path} : il faut au moins ${f.num(p.limit)} élément(s).` },
    'strat.invalid.too_many': { en: (p: Limit, f) => `${p.path}: at most ${f.num(p.limit)} items are accepted.`, fr: (p: Limit, f) => `${p.path} : ${f.num(p.limit)} éléments au plus sont acceptés.` },
    'strat.invalid.too_short': { en: (p: Limit, f) => `${p.path}: at least ${f.num(p.limit)} character(s) are needed.`, fr: (p: Limit, f) => `${p.path} : il faut au moins ${f.num(p.limit)} caractère(s).` },
    'strat.invalid.too_long': { en: (p: Limit, f) => `${p.path}: at most ${f.num(p.limit)} characters are accepted.`, fr: (p: Limit, f) => `${p.path} : ${f.num(p.limit)} caractères au plus sont acceptés.` },
    'strat.invalid.targets_over_100': {
        en: (p: Problem & { total: number }, f) => `${p.path}: the target weights add up to ${f.pctOf(p.total, 2)}, over 100%.`,
        fr: (p: Problem & { total: number }, f) => `${p.path} : les poids cibles totalisent ${f.pctOf(p.total, 2)}, plus de 100 %.`,
    },
    'strat.invalid.duplicate_target': {
        en: (p: Problem & { symbol: string }) => `${p.path}: ${p.symbol} has more than one target weight.`,
        fr: (p: Problem & { symbol: string }) => `${p.path} : ${p.symbol} a plus d’un poids cible.`,
    },
    'strat.invalid.recover_not_below_trigger': {
        en: (p: Problem & { value: number; limit: number }, f) => `${p.path}: the return threshold (${f.pctOf(p.value, 1)}) must be below the trigger (${f.pctOf(p.limit, 1)}).`,
        fr: (p: Problem & { value: number; limit: number }, f) => `${p.path} : le seuil de retour (${f.pctOf(p.value, 1)}) doit être inférieur au seuil de déclenchement (${f.pctOf(p.limit, 1)}).`,
    },
    'strat.invalid.amount_or_quantity': { en: (p: Problem) => `${p.path}: give either an amount in CAD or a quantity.`, fr: (p: Problem) => `${p.path} : indiquez soit un montant en dollars canadiens, soit une quantité.` },
    'strat.invalid.price_trigger_not_positive': { en: (p: Problem) => `${p.path}: a price trigger needs a price above zero.`, fr: (p: Problem) => `${p.path} : un déclencheur de cours exige un cours supérieur à zéro.` },
    'strat.invalid.change_trigger_out_of_range': {
        en: (p: Problem) => `${p.path}: a % change trigger needs a value between -100 and 100, other than 0.`,
        fr: (p: Problem) => `${p.path} : un déclencheur de variation en % exige une valeur entre -100 et 100, autre que 0.`,
    },
    'strat.invalid.duplicate_rule_id': {
        en: (p: Problem & { id: string }) => `${p.path}: two rules have the id ${p.id}.`,
        fr: (p: Problem & { id: string }) => `${p.path} : deux règles portent l’identifiant ${p.id}.`,
    },
    'strat.unknown_strategy': { en: (p: { id: string }) => `No strategy has the id ${p.id}.`, fr: (p: { id: string }) => `Aucune stratégie ne porte l’identifiant ${p.id}.` },
    'strat.unknown_replay': { en: (p: { id: string }) => `No replay with the id ${p.id} is in memory; run it again.`, fr: (p: { id: string }) => `Aucun rejeu portant l’identifiant ${p.id} n’est en mémoire; relancez-le.` },

    'strat.replay.empty_portfolio': {
        en: () => 'The simulated portfolio holds nothing to replay yet.',
        fr: () => 'Le portefeuille simulé ne contient encore rien à rejouer.',
    },
    'strat.replay.weights_over_100': {
        en: (p: { total: number }, f) => `The portfolio weights add up to ${f.pctOf(p.total, 2)}, over 100%.`,
        fr: (p: { total: number }, f) => `Les poids du portefeuille totalisent ${f.pctOf(p.total, 2)}, plus de 100 %.`,
    },
    'strat.replay.window_too_short': {
        en: () => 'The data snapshot has no two trading days on or after this start date.',
        fr: () => 'L’instantané de données ne compte pas deux jours de bourse à partir de cette date de départ.',
    },
    'strat.replay.nothing_to_replay': {
        en: () => 'None of the holdings has a price in the data snapshot on this start date.',
        fr: () => 'Aucune des positions n’a de cours dans l’instantané de données à cette date de départ.',
    },

    // ---- names
    'strat.kind': { en: (p: { kind: string }) => pick(KIND_EN, p.kind), fr: (p: { kind: string }) => pick(KIND_FR, p.kind) },

    // ---- rule events: the condition with its actual numbers
    'strat.event.guard_enter': {
        en: (p: GuardParams, f) => `Drawdown guard: at the close of ${p.day} the portfolio was worth ${f.cad(p.valueCad)}, ${f.pctOf(p.fallPct, 1)} under its peak of ${f.cad(p.peakValueCad)} (threshold: ${f.pctOf(p.thresholdPct, 1)}). ${f.pctOf(p.movePct, 0)} of the other holdings move to ${p.defensive}.`,
        fr: (p: GuardParams, f) => `Garde-fou de baisse : à la clôture du ${p.day}, le portefeuille valait ${f.cad(p.valueCad)}, soit ${f.pctOf(p.fallPct, 1)} sous son sommet de ${f.cad(p.peakValueCad)} (seuil : ${f.pctOf(p.thresholdPct, 1)}). ${f.pctOf(p.movePct, 0)} des autres positions sont déplacés vers ${p.defensive}.`,
    },
    'strat.event.guard_exit': {
        en: (p: GuardParams, f) => `End of the drawdown guard: at the close of ${p.day} the portfolio was ${f.pctOf(p.fallPct, 1)} under its peak, back under ${f.pctOf(p.thresholdPct, 1)}. The holdings return to their target weights.`,
        fr: (p: GuardParams, f) => `Fin du garde-fou de baisse : à la clôture du ${p.day}, le portefeuille était à ${f.pctOf(p.fallPct, 1)} sous son sommet, de retour sous ${f.pctOf(p.thresholdPct, 1)}. Les positions reviennent à leurs poids cibles.`,
    },
    'strat.event.weight_cap': {
        en: (p: CapParams, f) => `Weight cap: at the close of ${p.day}, ${p.symbol} was ${f.pctOf(p.weightPct, 1)} of the portfolio (cap: ${f.pctOf(p.capPct, 1)})${p.others > 0 ? `, and ${p.others} other holding(s) were over the cap` : ''}. The excess is sold${p.proceeds ? ` and goes to ${p.proceeds}` : ' and stays in cash'}.`,
        fr: (p: CapParams, f) => `Plafond par titre : à la clôture du ${p.day}, ${p.symbol} représentait ${f.pctOf(p.weightPct, 1)} du portefeuille (plafond : ${f.pctOf(p.capPct, 1)})${p.others > 0 ? `, et ${p.others} autre(s) position(s) dépassaient le plafond` : ''}. L’excédent est vendu${p.proceeds ? ` et placé dans ${p.proceeds}` : ' et reste en liquidités'}.`,
    },
    'strat.event.rebalance_quarterly': {
        en: (p: AllocationParams, f) => `Quarterly rebalancing (${p.quarter}): at the close of ${p.day}, the widest gap from target was ${pts(p.maxDriftPts, f)} points (${p.driftOf}). The holdings return to their target weights.`,
        fr: (p: AllocationParams, f) => `Rééquilibrage trimestriel (${p.quarter}) : à la clôture du ${p.day}, l’écart le plus grand avec la cible était de ${pts(p.maxDriftPts, f)} points (${p.driftOf}). Les positions reviennent à leurs poids cibles.`,
    },
    'strat.event.rebalance_drift': {
        en: (p: AllocationParams, f) => `Rebalancing on drift: at the close of ${p.day}, ${p.driftOf} was ${pts(p.maxDriftPts, f)} points away from its target (threshold: ${pts(p.thresholdPts ?? 0, f)} points). The holdings return to their target weights.`,
        fr: (p: AllocationParams, f) => `Rééquilibrage par dérive : à la clôture du ${p.day}, ${p.driftOf} s’écartait de ${pts(p.maxDriftPts, f)} points de sa cible (seuil : ${pts(p.thresholdPts ?? 0, f)} points). Les positions reviennent à leurs poids cibles.`,
    },
    'strat.event.periodic_purchase': {
        en: (p: PurchaseParams, f) => `Periodic purchase: at the close of ${p.day}, ${f.cad(p.amountCad)} of new money is added (${p.unit === 'month' ? 'every month' : `every ${p.n} trading days`}) and split by the target weights.`,
        fr: (p: PurchaseParams, f) => `Achat périodique : à la clôture du ${p.day}, ${f.cad(p.amountCad)} d’argent nouveau sont ajoutés (${p.unit === 'month' ? 'chaque mois' : `tous les ${p.n} jours de bourse`}) et répartis selon les poids cibles.`,
    },
    'strat.event.price_threshold': {
        en: (p: PriceParams, f) => (p.trigger.startsWith('price')
            ? `Price threshold: at the close of ${p.day}, ${p.symbol} was at ${f.num(p.price, 2)} ${p.currency}, ${p.trigger === 'price_below' ? 'below' : 'above'} ${f.num(p.threshold, 2)} ${p.currency}.`
            : `Price threshold: on ${p.day}, the day's change of ${p.symbol} was ${f.pctOf(p.changePct ?? 0, 2)}, ${p.trigger === 'change_pct_below' ? 'below' : 'above'} ${f.pctOf(p.threshold, 2)}.`),
        fr: (p: PriceParams, f) => (p.trigger.startsWith('price')
            ? `Seuil de cours : à la clôture du ${p.day}, ${p.symbol} était à ${f.num(p.price, 2)} ${p.currency}, ${p.trigger === 'price_below' ? 'sous' : 'au-dessus de'} ${f.num(p.threshold, 2)} ${p.currency}.`
            : `Seuil de cours : le ${p.day}, la variation du jour de ${p.symbol} était de ${f.pctOf(p.changePct ?? 0, 2)}, ${p.trigger === 'change_pct_below' ? 'sous' : 'au-dessus de'} ${f.pctOf(p.threshold, 2)}.`),
    },

    // ---- one simulated replay order
    'strat.order': {
        en: (p: OrderParams, f) =>
            `Simulated ${p.side === 'buy' ? 'purchase' : 'sale'} of ${units(p.quantity, f)} units of ${p.symbol} at ${f.cad(p.priceCad)} each (${f.cad(p.valueCad)}), fee ${f.cad(p.feeCad)}: ${pick(PURPOSE_EN, p.purpose)}, ${p.purpose === 'initial' ? `executed on ${p.executionDay}` : `decided at the close of ${p.decisionDay}, executed at the price of ${p.executionDay}`}.`
            + (p.adjustment ? ` Order ${pick(ADJUST_EN, p.adjustment)} (asked: ${f.cad(p.requestedValueCad ?? 0)}).` : ''),
        fr: (p: OrderParams, f) =>
            `${p.side === 'buy' ? 'Achat simulé' : 'Vente simulée'} de ${units(p.quantity, f)} unités de ${p.symbol} à ${f.cad(p.priceCad)} l’unité (${f.cad(p.valueCad)}), frais de ${f.cad(p.feeCad)} : ${pick(PURPOSE_FR, p.purpose)}, ${p.purpose === 'initial' ? `exécuté le ${p.executionDay}` : `décidé à la clôture du ${p.decisionDay}, exécuté au cours du ${p.executionDay}`}.`
            + (p.adjustment ? ` Ordre ${pick(ADJUST_FR, p.adjustment)} (demandé : ${f.cad(p.requestedValueCad ?? 0)}).` : ''),
    },
    // ---- an order that was not placed, with the reason
    'strat.drop': {
        en: (p: { symbol: string; side: 'buy' | 'sell'; reason: string; valueCad: number; minOrderCad: number | null }, f) => {
            const what = `${p.side === 'buy' ? 'Purchase' : 'Sale'} of ${p.symbol} (${f.cad(p.valueCad)}) not placed: `;
            if (p.reason === 'below_min_order') return `${what}under the minimum order of ${f.cad(p.minOrderCad ?? 0)}.`;
            if (p.reason === 'no_price') return `${what}no price was known for it on that day.`;
            if (p.reason === 'insufficient_cash') return `${what}the cash available did not cover it.`;
            return `${what}the portfolio did not hold enough units.`;
        },
        fr: (p: { symbol: string; side: 'buy' | 'sell'; reason: string; valueCad: number; minOrderCad: number | null }, f) => {
            const what = `${p.side === 'buy' ? 'Achat' : 'Vente'} de ${p.symbol} (${f.cad(p.valueCad)}) non passé${p.side === 'buy' ? '' : 'e'} : `;
            if (p.reason === 'below_min_order') return `${what}sous l’ordre minimal de ${f.cad(p.minOrderCad ?? 0)}.`;
            if (p.reason === 'no_price') return `${what}aucun cours n’était connu ce jour-là.`;
            if (p.reason === 'insufficient_cash') return `${what}les liquidités disponibles ne le couvraient pas.`;
            return `${what}le portefeuille ne détenait pas assez d’unités.`;
        },
    },

    // ---- symbols left out of a replay
    'strat.unreplayable': {
        en: (p: { symbol: string; reason: string; date: string | null }) => ({
            not_in_snapshot: `${p.symbol} is not in the frozen data snapshot.`,
            starts_later: `${p.symbol} has no price yet on the first day of the replay (its history starts on ${p.date ?? '?'}).`,
            ends_earlier: `The history of ${p.symbol} stops on ${p.date ?? '?'}, before the end of the replay.`,
        })[p.reason] ?? `${p.symbol} could not be replayed.`,
        fr: (p: { symbol: string; reason: string; date: string | null }) => ({
            not_in_snapshot: `${p.symbol} ne figure pas dans l’instantané de données figé.`,
            starts_later: `${p.symbol} n’a pas encore de cours au premier jour du rejeu (son historique commence le ${p.date ?? '?'}).`,
            ends_earlier: `L’historique de ${p.symbol} s’arrête le ${p.date ?? '?'}, avant la fin du rejeu.`,
        })[p.reason] ?? `${p.symbol} n’a pas pu être rejoué.`,
    },

    // ---- assumptions of every replay, shown next to it
    'strat.assume.execution': {
        en: () => 'Each rule is evaluated at the close of a day and its orders are filled at the closing price of the next trading day.',
        fr: () => 'Chaque règle est évaluée à la clôture d’une journée et ses ordres sont exécutés au cours de clôture du jour de bourse suivant.',
    },
    'strat.assume.total_return': {
        en: () => 'Prices are adjusted closes: dividends are reinvested in the holding that paid them, so no dividend goes through cash. Price thresholds are tested on the unadjusted close.',
        fr: () => 'Les cours sont des clôtures ajustées : les dividendes sont réinvestis dans la position qui les a versés, donc aucun dividende ne passe par les liquidités. Les seuils de cours sont testés sur la clôture non ajustée.',
    },
    'strat.assume.fx': {
        en: () => 'Everything is valued in CAD with the USD/CAD rate of the day (the last known rate when a day has none).',
        fr: () => 'Tout est évalué en dollars canadiens au taux USD/CAD du jour (le dernier taux connu lorsqu’un jour n’en a pas).',
    },
    'strat.assume.fees': {
        en: (p: { feeCad: number }, f) => `Fee per order: ${f.cad(p.feeCad)}. No taxes. Fractional units are allowed. The reference portfolios pay no fee.`,
        fr: (p: { feeCad: number }, f) => `Frais par ordre : ${f.cad(p.feeCad)}. Aucun impôt. Les fractions d’unités sont permises. Les portefeuilles de référence ne paient aucuns frais.`,
    },
    'strat.assume.contributions': {
        en: () => 'Money added by a periodic purchase is new cash, counted apart: returns, volatility and worst fall are measured on the growth of each dollar invested (time-weighted), not on the amounts added.',
        fr: () => 'L’argent ajouté par un achat périodique est de l’argent nouveau, compté à part : le rendement, la volatilité et le pire repli sont mesurés sur la croissance de chaque dollar investi (pondération dans le temps), pas sur les montants ajoutés.',
    },
    'strat.assume.xray_difference': {
        en: () => 'The X-ray applies today’s weights to past price changes without dividends; the time machine follows a strategy through time with dividends reinvested. The two figures are not comparable.',
        fr: () => 'La radiographie applique les poids d’aujourd’hui aux variations de cours passées, sans dividendes; la machine à remonter le temps suit une stratégie dans le temps, dividendes réinvestis. Les deux chiffres ne sont pas comparables.',
    },
    'strat.assume.illustrative': {
        en: () => 'Illustrative replay on historical data. This is not a prediction.',
        fr: () => 'Rejeu illustratif sur données historiques. Ce n’est pas une prédiction.',
    },
});

export type StrategyTextKey = keyof typeof STRATEGY_TEXT;
export const sayStrategy = sayer(STRATEGY_TEXT);
export const strategyRef = (key: StrategyTextKey, params: Record<string, TextParam> = {}): TextRef => ({ key, params });
