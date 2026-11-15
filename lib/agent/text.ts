// Every fixed sentence the agent side of the web app shows, in English and in French (Canadian French, plain,
// vouvoiement). Figures are formatted with Intl in the active language (i18n/format), never by hand. The words
// of these sentences are checked against the never-lists and the judgement lists by __tests__/agent/text.test.ts.

import type { Locale } from '@/i18n/config';
import { formatMoney, formatNumber, formatPercent } from '@/i18n/format';
import type { InvestmentRule, Level, Risk } from '@/lib/domain/types';

type RuleView = Pick<InvestmentRule, 'symbol' | 'trigger' | 'action' | 'once'>;
type Status = 'pending' | 'applying' | 'applied' | 'undoing' | 'undone' | 'cancelled';

const enMoney = (value: number) => value.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** An amount with its currency: "1,500.00 CAD" in English, "1 500,00 $" / "1 500,00 $ US" in French. */
const amount = (locale: Locale, value: number, currency = '') => {
    if (locale === 'en') return `${enMoney(value)} ${currency}`.trim();
    return currency ? formatMoney(value, currency, 'fr') : formatNumber(value, 'fr', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const units = (locale: Locale, value: number) => (locale === 'en' ? `${Number(value.toFixed(6))} units` : `${formatNumber(Number(value.toFixed(6)), 'fr', { maximumFractionDigits: 6 })} unités`);

const LEVEL_FR: Record<Level, string> = { Novice: 'Novice', Intermediate: 'Intermédiaire', Expert: 'Expert' };
const RISK_FR: Record<Risk, string> = { Low: 'Faible', Medium: 'Moyen', High: 'Élevé' };
const RULE_STATUS_FR: Record<InvestmentRule['status'], string> = { active: 'active', paused: 'suspendue' };
const STATUS_FR: Record<Status, string> = {
    pending: 'en attente', applying: 'en cours d’application', applied: 'appliquée', undoing: 'en cours d’annulation', undone: 'annulée après application', cancelled: 'abandonnée',
};

const en = {
    neutralReply: 'The app withheld this reply because of its wording. I can explain a term from the glossary, show data with its source, or explain why an asset is on your list. This app is a simulation and does not give investment advice.',
    tooMany: 'Too many requests. Wait a minute and try again.',
    emptyMessage: 'write a message first',
    agentDown: 'The agent service is not reachable right now. Nothing was changed.',
    agentTimeout: (seconds: number) => `The agent service did not answer within ${seconds} seconds. Nothing was changed.`,
    agentUnreadable: 'The agent service sent a reply the app could not read. Nothing was changed.',
    notShown: (reason: string) => `A proposed change was not shown: ${reason}`,
    paramsInvalidShort: 'its parameters are not valid.',
    cancelled: 'Cancelled. Nothing was changed.',
    noSuchChange: 'No proposed change has this id.',
    onlyPending: (status: Status) => `This change is ${status}; only a pending change can be applied.`,
    wrongStatus: (was: Status | undefined, from: Status, to: Status) =>
        `This change is ${was}; only ${from === 'applied' ? 'an' : 'a'} ${from} change can be ${to === 'applying' ? 'applied' : to === 'undoing' ? 'undone' : to}.`,
    // router: drops
    badForm: 'The proposal was not in a form the app accepts.',
    notAllowed: (type: string) => `"${type}" is not an action the app allows.`,
    paramsInvalid: (type: string, detail: string) => `The parameters of the proposed ${type.replace('_', ' ')} are not valid (${detail}).`,
    otherError: (message: string) => message,
    // layout
    sameLayout: 'The proposed layout is the same as the current one.',
    none: 'none',
    layoutSummary: (removed: string[], added: string[]) => {
        const parts = [removed.length > 0 ? `removes ${removed.join(', ')}` : '', added.length > 0 ? `adds ${added.join(', ')}` : ''].filter(Boolean);
        return `Dashboard layout: ${parts.length > 0 ? parts.join('; ') : 'changes the order of the widgets'}.`;
    },
    portfolioTab: 'Portfolio tab',
    overviewTab: 'Overview tab',
    layoutApplied: 'The dashboard layout was changed.',
    layoutRestored: 'The previous dashboard layout is back.',
    // rules
    ruleSentence: (rule: RuleView, currency = '') => {
        const { type, value } = rule.trigger;
        const relation = type.endsWith('below') ? 'below' : 'above';
        const trigger = type.startsWith('price')
            ? `the price of ${rule.symbol} is ${relation} ${amount('en', value, currency)}`
            : `the change today of ${rule.symbol} is ${relation} ${value.toFixed(2)}%`;
        const size = rule.action.amountCad !== undefined ? `${enMoney(rule.action.amountCad)} CAD` : `${rule.action.quantity} units`;
        const action = rule.action.side === 'buy' ? `simulate a purchase of ${size} of ${rule.symbol}` : `reduce the simulated position in ${rule.symbol} by ${size}`;
        return `When ${trigger}, ${action}, ${rule.once ? 'one time only' : 'at most once per market day'}.`;
    },
    ruleInvalid: (errors: string[]) => `The rule cannot be created: ${errors.join(' ')}`,
    ruleSummary: (symbol: string) => `New simulated rule on ${symbol}. It runs in the simulation only.`,
    ruleLabel: 'Rule',
    noRule: 'no rule',
    yourWording: 'Your wording',
    lastPrice: (symbol: string) => `${symbol} last price`,
    noRuleWithId: (id: string) => `No rule has the id ${id}.`,
    ruleAlready: (status: InvestmentRule['status']) => `The rule is already ${status}.`,
    ruleStatus: (status: InvestmentRule['status']): string => status,
    pauseSummary: (status: InvestmentRule['status'], symbol: string) => `${status === 'paused' ? 'Pauses' : 'Resumes'} the simulated rule on ${symbol}.`,
    statusLabel: 'Status',
    ruleCreated: (symbol: string, id: string) => `The simulated rule on ${symbol} is active (${id}).`,
    ruleNowStatus: (symbol: string, status: InvestmentRule['status']) => `The simulated rule on ${symbol} is now ${status}.`,
    ruleGone: 'The rule no longer exists.',
    rulePausedInstead: 'The rule had already fired once, so it was paused instead of removed.',
    ruleRemoved: 'The simulated rule was removed.',
    ruleAgain: (status: InvestmentRule['status']) => `The simulated rule is ${status} again.`,
    // profile
    sameProfile: 'The proposed profile change is the same as the current profile.',
    notAsked: 'not asked',
    levelLabel: 'Level',
    riskLabel: 'Risk',
    level: (level: Level): string => level,
    risk: (risk: Risk): string => risk,
    profileSummary: (named: string[]) => `Profile change: ${named.length > 0 ? named.join(', ') : 'answers'}. The Level and Risk rules were re-run.`,
    levelRule: (version: string) => `Level rule (${version})`,
    riskRule: (version: string) => `Risk rule (${version})`,
    rulePoints: (value: string, points: number, byHand: boolean) => `${value}, ${points} points${byHand ? '; set by hand' : ''}`,
    derived: 'derived',
    noProfile: 'No profile exists yet. Complete onboarding first.',
    profileApplied: (level: Level, risk: Risk) => `The profile was changed: level ${level}, risk ${risk}.`,
    profileRestored: (level: Level, risk: Risk) => `The previous profile is back: level ${level}, risk ${risk}.`,
    // simulated trades
    notInList: (symbol: string) => `${symbol} is not in the app's list of assets, so it cannot be simulated.`,
    referenceOnly: (name: string) => `${name} is a reference value here and cannot be traded in the simulation.`,
    noPrice: (symbol: string) => `No price with a source is available for ${symbol} right now, so nothing can be previewed.`,
    noCad: (symbol: string) => `The price of ${symbol} cannot be converted to CAD right now.`,
    notEnoughCash: (cash: number, needed: number) => `Simulated cash is ${enMoney(cash)} CAD; this purchase needs ${enMoney(needed)} CAD.`,
    notEnoughUnits: (symbol: string, held: number, quantity: number) => `The simulated position in ${symbol} is ${held} units; ${quantity.toFixed(6)} cannot be removed.`,
    purchaseSummary: (valueCad: number, symbol: string, name: string) => `Simulated purchase of about ${enMoney(valueCad)} CAD of ${symbol} (${name}). No real order exists.`,
    reductionSummary: (valueCad: number, symbol: string, name: string) => `Simulated reduction of the ${symbol} position (${name}) by about ${enMoney(valueCad)} CAD. No real order exists.`,
    cashLabel: 'Simulated cash',
    cad: (value: number) => `${enMoney(value)} CAD`,
    about: (text: string) => `about ${text}`,
    positionLabel: (symbol: string) => `${symbol} position`,
    units: (value: number) => units('en', value),
    price: (value: number, currency?: string) => amount('en', value, currency ?? ''),
    fxLabel: 'USD/CAD rate',
    fx: (value: number) => String(value),
    fillLabel: 'Fill',
    fillValue: 'at the last price at the moment you confirm, so the figures above are estimates',
    tradeApplied: (quantity: number, symbol: string, price: string, source: string, valueCad: number, cashCad: number) =>
        `Simulated: ${quantity} units of ${symbol} at ${price} (${source}), ${enMoney(valueCad)} CAD. Simulated cash is now ${enMoney(cashCad)} CAD.`,
    tradeUndone: (quantity: number, symbol: string, price: string, source: string, valueCad: number) =>
        `Undo: a compensating simulated trade of ${quantity} units of ${symbol} at ${price} (${source}), ${enMoney(valueCad)} CAD. Both trades stay in the log; cash can differ from before when the price moved.`,
    nothingToApply: 'This kind of action has nothing to apply.',
    nothingToUndo: 'This change holds nothing to undo.',
};

export type AgentText = typeof en;

const fr: AgentText = {
    neutralReply: 'L’application a retenu cette réponse en raison de sa formulation. Je peux expliquer un terme du glossaire, présenter des données avec leur source ou expliquer pourquoi un titre figure sur votre liste. Cette application est une simulation et ne donne aucun conseil en placement.',
    tooMany: 'Trop de demandes. Attendez une minute, puis réessayez.',
    emptyMessage: 'écrivez d’abord un message',
    agentDown: 'Le service de l’agent est injoignable pour le moment. Rien n’a été modifié.',
    agentTimeout: (seconds) => `Le service de l’agent n’a pas répondu dans les ${formatNumber(seconds, 'fr')} secondes. Rien n’a été modifié.`,
    agentUnreadable: 'Le service de l’agent a envoyé une réponse que l’application ne peut pas lire. Rien n’a été modifié.',
    notShown: (reason) => `Une modification proposée n’a pas été affichée : ${reason}`,
    paramsInvalidShort: 'ses paramètres ne sont pas valides.',
    cancelled: 'Annulé. Rien n’a été modifié.',
    noSuchChange: 'Aucune modification proposée ne porte cet identifiant.',
    onlyPending: (status) => `Cette modification est ${STATUS_FR[status] ?? status}; seule une modification en attente peut être appliquée.`,
    wrongStatus: (was, from, to) =>
        `Cette modification est ${was ? STATUS_FR[was] ?? was : 'introuvable'}; seule une modification ${STATUS_FR[from]} peut être ${to === 'applying' ? 'appliquée' : to === 'undoing' ? 'annulée' : STATUS_FR[to]}.`,
    badForm: 'La proposition n’est pas dans une forme que l’application accepte.',
    notAllowed: (type) => `« ${type} » n’est pas une action permise par l’application.`,
    // The detail comes from the schema in English; it stays in the action log only.
    paramsInvalid: () => 'Les paramètres de la modification proposée ne sont pas valides.',
    // A refusal worded by another part of the app (in English) is replaced by a French sentence; the log keeps it.
    otherError: () => 'La modification proposée ne peut pas être prévisualisée avec les données actuelles.',
    sameLayout: 'La disposition proposée est identique à la disposition actuelle.',
    none: 'aucun',
    layoutSummary: (removed, added) => {
        const parts = [removed.length > 0 ? `retire ${removed.join(', ')}` : '', added.length > 0 ? `ajoute ${added.join(', ')}` : ''].filter(Boolean);
        return `Disposition du tableau de bord : ${parts.length > 0 ? parts.join('; ') : 'modifie l’ordre des modules'}.`;
    },
    portfolioTab: 'Onglet Portefeuille',
    overviewTab: 'Onglet Aperçu',
    layoutApplied: 'La disposition du tableau de bord a été modifiée.',
    layoutRestored: 'La disposition précédente du tableau de bord est rétablie.',
    ruleSentence: (rule, currency = '') => {
        const { type, value } = rule.trigger;
        const relation = type.endsWith('below') ? 'inférieur' : 'supérieur';
        const trigger = type.startsWith('price')
            ? `le cours de ${rule.symbol} est ${relation} à ${amount('fr', value, currency)}`
            : `la variation du jour de ${rule.symbol} est ${relation}e à ${formatPercent(value, 'fr', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        const size = rule.action.amountCad !== undefined ? amount('fr', rule.action.amountCad, 'CAD') : units('fr', rule.action.quantity ?? 0);
        const action = rule.action.side === 'buy' ? `simuler une acquisition de ${size} de ${rule.symbol}` : `réduire la position simulée en ${rule.symbol} de ${size}`;
        return `Lorsque ${trigger}, ${action}, ${rule.once ? 'une seule fois' : 'au plus une fois par jour de bourse'}.`;
    },
    ruleInvalid: () => 'La règle ne peut pas être créée : ses paramètres ne sont pas valides.',
    ruleSummary: (symbol) => `Nouvelle règle simulée sur ${symbol}. Elle s’applique seulement dans la simulation.`,
    ruleLabel: 'Règle',
    noRule: 'aucune règle',
    yourWording: 'Votre formulation',
    lastPrice: (symbol) => `Dernier cours de ${symbol}`,
    noRuleWithId: (id) => `Aucune règle ne porte l’identifiant ${id}.`,
    ruleAlready: (status) => `La règle est déjà ${RULE_STATUS_FR[status] ?? status}.`,
    ruleStatus: (status) => RULE_STATUS_FR[status] ?? status,
    pauseSummary: (status, symbol) => `${status === 'paused' ? 'Suspend' : 'Reprend'} la règle simulée sur ${symbol}.`,
    statusLabel: 'Statut',
    ruleCreated: (symbol, id) => `La règle simulée sur ${symbol} est active (${id}).`,
    ruleNowStatus: (symbol, status) => `La règle simulée sur ${symbol} est maintenant ${RULE_STATUS_FR[status] ?? status}.`,
    ruleGone: 'La règle n’existe plus.',
    rulePausedInstead: 'La règle s’était déjà déclenchée une fois; elle a donc été suspendue au lieu d’être supprimée.',
    ruleRemoved: 'La règle simulée a été supprimée.',
    ruleAgain: (status) => `La règle simulée est de nouveau ${RULE_STATUS_FR[status] ?? status}.`,
    sameProfile: 'La modification de profil proposée est identique au profil actuel.',
    notAsked: 'question non posée',
    levelLabel: 'Niveau',
    riskLabel: 'Profil de risque',
    level: (level) => LEVEL_FR[level] ?? level,
    risk: (risk) => RISK_FR[risk] ?? risk,
    profileSummary: (named) => `Modification du profil : ${named.length > 0 ? named.join(', ') : 'réponses'}. Les règles de niveau et de risque ont été appliquées de nouveau.`,
    levelRule: (version) => `Règle de niveau (${version})`,
    riskRule: (version) => `Règle de risque (${version})`,
    rulePoints: (value, points, byHand) => `${value}, ${formatNumber(points, 'fr')} points${byHand ? '; défini manuellement' : ''}`,
    derived: 'calculé',
    noProfile: 'Aucun profil n’existe encore. Configurez d’abord votre profil.',
    profileApplied: (level, risk) => `Le profil a été modifié : niveau ${LEVEL_FR[level] ?? level}, profil de risque ${RISK_FR[risk] ?? risk}.`,
    profileRestored: (level, risk) => `Le profil précédent est rétabli : niveau ${LEVEL_FR[level] ?? level}, profil de risque ${RISK_FR[risk] ?? risk}.`,
    notInList: (symbol) => `${symbol} ne figure pas dans la liste d’actifs de l’application; il ne peut donc pas être simulé.`,
    referenceOnly: (name) => `${name} est une valeur de référence ici et ne peut pas faire l’objet d’une opération simulée.`,
    noPrice: (symbol) => `Aucun cours accompagné d’une source n’est disponible pour ${symbol} en ce moment; aucun aperçu n’est donc possible.`,
    noCad: (symbol) => `Le cours de ${symbol} ne peut pas être converti en dollars canadiens en ce moment.`,
    notEnoughCash: (cash, needed) => `Les liquidités simulées sont de ${amount('fr', cash, 'CAD')}; cette acquisition demande ${amount('fr', needed, 'CAD')}.`,
    notEnoughUnits: (symbol, held, quantity) => `La position simulée en ${symbol} est de ${units('fr', held)}; ${formatNumber(Number(quantity.toFixed(6)), 'fr', { maximumFractionDigits: 6 })} ne peuvent pas être retirées.`,
    purchaseSummary: (valueCad, symbol, name) => `Acquisition simulée d’environ ${amount('fr', valueCad, 'CAD')} de ${symbol} (${name}). Aucun ordre réel n’existe.`,
    reductionSummary: (valueCad, symbol, name) => `Réduction simulée de la position en ${symbol} (${name}) d’environ ${amount('fr', valueCad, 'CAD')}. Aucun ordre réel n’existe.`,
    cashLabel: 'Liquidités simulées',
    cad: (value) => amount('fr', value, 'CAD'),
    about: (text) => `environ ${text}`,
    positionLabel: (symbol) => `Position en ${symbol}`,
    units: (value) => units('fr', value),
    price: (value, currency) => amount('fr', value, currency ?? ''),
    fxLabel: 'Taux de change USD/CAD',
    fx: (value) => formatNumber(value, 'fr', { maximumFractionDigits: 6 }),
    fillLabel: 'Exécution',
    fillValue: 'au dernier cours au moment où vous confirmez; les chiffres ci-dessus sont donc des estimations',
    tradeApplied: (quantity, symbol, price, source, valueCad, cashCad) =>
        `Opération simulée : ${units('fr', quantity)} de ${symbol} à ${price} (${source}), ${amount('fr', valueCad, 'CAD')}. Les liquidités simulées sont maintenant de ${amount('fr', cashCad, 'CAD')}.`,
    tradeUndone: (quantity, symbol, price, source, valueCad) =>
        `Annulation : une opération simulée inverse de ${units('fr', quantity)} de ${symbol} à ${price} (${source}), ${amount('fr', valueCad, 'CAD')}. Les deux opérations restent dans le journal; les liquidités peuvent différer d’avant si le cours a bougé.`,
    nothingToApply: 'Ce type d’action n’a rien à appliquer.',
    nothingToUndo: 'Cette modification n’a rien à annuler.',
};

const TEXT: Record<Locale, AgentText> = { en, fr };

/** The agent's fixed sentences in one language; anything but French gets English. */
export const agentText = (locale: Locale | string | undefined): AgentText => (locale === 'fr' ? TEXT.fr : TEXT.en);
