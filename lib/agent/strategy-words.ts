// The fixed sentences of a strategy proposal (action strategy_propose), in English and in French (Canadian French,
// vouvoiement): one sentence per rule written from its own fields, the labels of the without / with table, and the
// strategy-level conflict notes. No model writes these. Words are kept off the never-lists and the judgement lists
// ("largest fall", "repli maximal"; "periodic contribution", "versement périodique").

import type { Locale } from '@/i18n/config';
import { formatMoney, formatNumber, formatPercent } from '@/i18n/format';
import type { AllocationTarget, StrategyRule } from '@/lib/strategy/types';

const pct = (value: number, locale: Locale, digits = 1) => formatPercent(value, locale, { maximumFractionDigits: digits });
const cad = (value: number, locale: Locale) => formatMoney(value, 'CAD', locale);
const num = (value: number, locale: Locale, digits = 2) => formatNumber(value, locale, { maximumFractionDigits: digits });

function targetsText(targets: AllocationTarget[], locale: Locale): string {
    return targets.map((target) => ('symbol' in target
        ? `${target.symbol} ${pct(target.weightPct, locale, 2)}`
        : `${target.group} (${target.symbols.join(', ')}) ${pct(target.weightPct, locale, 2)}`)).join(', ');
}

/** One rule as a sentence, from its fields only. */
export function strategyRuleSentence(rule: StrategyRule, locale: Locale): string {
    const fr = locale === 'fr';
    switch (rule.kind) {
        case 'allocation_target': {
            const targets = targetsText(rule.targets, locale);
            const when = rule.rebalance.mode === 'quarterly'
                ? (fr ? 'rééquilibrage chaque trimestre' : 'rebalanced every quarter')
                : (fr ? `rééquilibrage lorsqu’une position s’écarte de plus de ${num(rule.rebalance.driftPts, locale, 1)} points de sa cible` : `rebalanced when a holding drifts more than ${num(rule.rebalance.driftPts, locale, 1)} points from its target`);
            return fr ? `Poids cibles : ${targets}; ${when}.` : `Target weights: ${targets}; ${when}.`;
        }
        case 'weight_cap': {
            const where = rule.proceedsSymbol
                ? (fr ? `l’excédent est placé dans ${rule.proceedsSymbol}` : `the excess goes to ${rule.proceedsSymbol}`)
                : (fr ? 'l’excédent reste en liquidités' : 'the excess stays in cash');
            return fr ? `Aucune position au-delà de ${pct(rule.maxWeightPct, locale)} du portefeuille; ${where}.` : `No holding above ${pct(rule.maxWeightPct, locale)} of the portfolio; ${where}.`;
        }
        case 'drawdown_guard':
            return fr
                ? `Garde-fou de baisse : si le portefeuille recule de ${pct(rule.triggerDrawdownPct, locale)} sous son sommet, ${pct(rule.movePct, locale, 0)} des autres positions sont déplacés vers ${rule.defensiveSymbol}; elles reviennent à leurs poids cibles lorsque le repli redevient inférieur à ${pct(rule.recoverDrawdownPct, locale)}.`
                : `Drawdown guard: if the portfolio falls ${pct(rule.triggerDrawdownPct, locale)} under its peak, ${pct(rule.movePct, locale, 0)} of the other holdings move to ${rule.defensiveSymbol}; they return to their target weights once the fall is back under ${pct(rule.recoverDrawdownPct, locale)}.`;
        case 'periodic_purchase': {
            const every = rule.every.unit === 'month' ? (fr ? 'chaque mois' : 'every month') : (fr ? `tous les ${rule.every.n} jours de bourse` : `every ${rule.every.n} trading days`);
            return fr
                ? `Versement périodique : ${cad(rule.amountCad, locale)} d’argent nouveau ${every}, répartis selon les poids cibles.`
                : `Periodic contribution: ${cad(rule.amountCad, locale)} of new money ${every}, split by the target weights.`;
        }
        case 'price_threshold': {
            const { type, value } = rule.trigger;
            const below = type.endsWith('below');
            const trigger = type.startsWith('price')
                ? (fr ? `le cours de ${rule.symbol} est ${below ? 'sous' : 'au-dessus de'} ${num(value, locale)}` : `the price of ${rule.symbol} is ${below ? 'below' : 'above'} ${num(value, locale)}`)
                : (fr ? `la variation du jour de ${rule.symbol} est ${below ? 'sous' : 'au-dessus de'} ${pct(value, locale, 2)}` : `the day’s change of ${rule.symbol} is ${below ? 'below' : 'above'} ${pct(value, locale, 2)}`);
            const size = rule.action.amountCad !== undefined ? cad(rule.action.amountCad, locale) : (fr ? `${num(rule.action.quantity ?? 0, locale, 6)} unités` : `${num(rule.action.quantity ?? 0, locale, 6)} units`);
            const action = rule.action.side === 'buy'
                ? (fr ? `acquisition simulée de ${size} de ${rule.symbol}` : `simulated purchase of ${size} of ${rule.symbol}`)
                : (fr ? `réduction simulée de la position ${rule.symbol} de ${size}` : `simulated reduction of the ${rule.symbol} position by ${size}`);
            const once = rule.once ? (fr ? 'une seule fois' : 'one time only') : (fr ? 'au plus une fois par jour de bourse' : 'at most once per market day');
            return fr ? `Lorsque ${trigger}, ${action}, ${once}.` : `When ${trigger}, ${action}, ${once}.`;
        }
    }
}

const KIND = {
    en: { price_threshold: 'Price threshold', allocation_target: 'Rebalancing', weight_cap: 'Weight cap', drawdown_guard: 'Drawdown guard', periodic_purchase: 'Periodic contribution' },
    fr: { price_threshold: 'Seuil de cours', allocation_target: 'Rééquilibrage', weight_cap: 'Plafond par titre', drawdown_guard: 'Garde-fou de baisse', periodic_purchase: 'Versement périodique' },
} as const;

export const strategyWords = (locale: Locale) => {
    const fr = locale === 'fr';
    return {
        kind: (kind: StrategyRule['kind']) => KIND[fr ? 'fr' : 'en'][kind],
        summaryNew: (name: string, count: number) => (fr ? `Nouvelle stratégie simulée « ${name} » : ${count} règle(s).` : `New simulated strategy “${name}”: ${count} rule(s).`),
        summaryReplace: (name: string, count: number) => (fr ? `Nouvelle version de la stratégie simulée « ${name} » : ${count} règle(s).` : `New version of the simulated strategy “${name}”: ${count} rule(s).`),
        strategyLabel: fr ? 'Stratégie' : 'Strategy',
        noStrategy: fr ? 'aucune stratégie' : 'no strategy',
        without: fr ? 'Sans règles' : 'Without rules',
        with: fr ? 'Avec la stratégie' : 'With the strategy',
        finalValue: fr ? 'Valeur finale' : 'Final value',
        totalReturn: fr ? 'Rendement total' : 'Total return',
        largestFall: fr ? 'Repli maximal depuis un sommet' : 'Largest fall from a peak',
        volatility: fr ? 'Volatilité annualisée' : 'Annualised volatility',
        fired: (count: number) => (fr ? `${count} déclenchement(s)` : `fired ${count} time(s)`),
        window: (from: string, to: string, days: number) => (fr ? `Du ${from} au ${to} (${days} jours de bourse), sur le portefeuille simulé actuel` : `From ${from} to ${to} (${days} trading days), on the current simulated portfolio`),
        windowLabel: fr ? 'Période rejouée' : 'Replayed period',
        capitalLabel: fr ? 'Capital de départ' : 'Starting capital',
        replayLabel: fr ? 'Rejeu' : 'Replay',
        replayIds: (replayId: string, snapshotId: string) => (fr ? `rejeu ${replayId}, instantané ${snapshotId}` : `replay ${replayId}, snapshot ${snapshotId}`),
        illustrative: fr ? 'Rejeu illustratif sur données historiques. Ce n’est pas une prédiction.' : 'Illustrative replay on historical data. This is not a prediction.',
        unreplayable: (symbols: string[]) => (fr ? `Non rejoués (absents de l’instantané ou historique trop court) : ${symbols.join(', ')}` : `Not replayed (not in the snapshot or history too short): ${symbols.join(', ')}`),
        replayUnavailable: (why: string) => (fr ? `Aperçu historique indisponible : ${why}` : `History preview unavailable: ${why}`),
        unchecked: (symbols: string[]) => (fr ? `Hors de la liste d’actifs de l’application, profil non vérifié : ${symbols.join(', ')}` : `Not in the app’s list of assets, profile not checked: ${symbols.join(', ')}`),
        derived: fr ? 'calculé par l’application (moteur de rejeu)' : 'computed by the app (replay engine)',
        invalid: (messages: string[]) => (fr ? `La stratégie ne peut pas être proposée : ${messages.join(' ')}` : `The strategy cannot be proposed: ${messages.join(' ')}`),
        unknownStrategy: (id: string) => (fr ? `Aucune stratégie ne porte l’identifiant ${id}.` : `No strategy has the id ${id}.`),
        noProfile: fr ? 'Aucun profil n’existe encore. Terminez d’abord l’accueil.' : 'No profile exists yet. Complete onboarding first.',
        saved: (name: string, id: string, version: number) => (fr ? `La stratégie simulée « ${name} » est enregistrée (${id}, version ${version}).` : `The simulated strategy “${name}” is saved (${id}, version ${version}).`),
        removed: (name: string) => (fr ? `La stratégie « ${name} » est retirée. Elle reste dans le journal.` : `The strategy “${name}” is removed. It stays in the log.`),
        restored: (name: string, version: number) => (fr ? `La version ${version} de la stratégie « ${name} » est rétablie.` : `Version ${version} of the strategy “${name}” is back.`),
        gone: fr ? 'La stratégie n’existe plus.' : 'The strategy no longer exists.',
        // strategy-level conflicts
        prefixed: (symbol: string, detail: string) => (fr ? `${symbol} : ${detail}` : `${symbol}: ${detail}`),
        highVolShare: (sharePct: number, limitPct: number, capPct: number, risk: string, symbols: string[]) => (fr
            ? `${pct(sharePct, locale)} des poids cibles sont dans des actifs dont la volatilité sur 1 an dépasse le plafond de ${pct(capPct, locale)} du profil ${risk} (${symbols.join(', ')}), pour un seuil de ${pct(limitPct, locale, 0)}.`
            : `${pct(sharePct, locale)} of the target weights are in assets whose 1-year volatility is above the ${pct(capPct, locale)} cap of the ${risk} profile (${symbols.join(', ')}), against a threshold of ${pct(limitPct, locale, 0)}.`),
        cryptoRisk: (symbol: string, risk: string) => (fr
            ? `${symbol} est une cryptomonnaie; le profil ${risk} n’en admet pas (seul le profil Élevé en admet).`
            : `${symbol} is a cryptocurrency; the ${risk} profile does not admit one (only the High profile does).`),
    };
};

export const riskName = (risk: string, locale: Locale) => (locale === 'fr' ? ({ Low: 'Faible', Medium: 'Moyen', High: 'Élevé' } as Record<string, string>)[risk] ?? risk : risk);
