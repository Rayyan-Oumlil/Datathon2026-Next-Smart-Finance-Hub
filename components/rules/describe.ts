// A rule in plain words. The same sentence is the preview before saving and the rule's stored wording.
// Its text comes from the Rules message files, so it reads in the language that is active when it is built.

import type { InvestmentRule } from '@/lib/domain/types';
import { formatNumber, formatPercent } from '@/i18n/format';
import { cad, type Translate } from '@/components/portfolio/logic';

export type RuleDraft = Pick<InvestmentRule, 'symbol' | 'trigger' | 'action' | 'once'>;
export type TriggerType = InvestmentRule['trigger']['type'];

export const TRIGGER_TYPES: readonly TriggerType[] = ['price_below', 'price_above', 'change_pct_below', 'change_pct_above'];

/** The label of a trigger type, from the Rules messages. */
export const triggerLabel = (type: TriggerType, t: Translate) => t(`triggers.${type}`);

export const isPriceTrigger = (type: TriggerType) => type === 'price_below' || type === 'price_above';

/** The currency a price trigger is read in: the asset's quote currency (USD for US listings, CAD for .TO and crypto). */
export const quoteCurrency = (symbol: string) => (/\.TO$/i.test(symbol) || /^(BTC|ETH)$/i.test(symbol) ? 'CAD' : 'USD');

const TWO = { minimumFractionDigits: 2, maximumFractionDigits: 2 } as const;

/** "When AAPL is below 150.00 USD, simulate a purchase of 500.00 CAD, once." (t is the Rules translator) */
export function describeRule({ symbol, trigger, action, once }: RuleDraft, t: Translate, locale: string): string {
    const relation = trigger.type.endsWith('below') ? 'below' : 'above';
    const condition = isPriceTrigger(trigger.type)
        ? t('describe.conditionPrice', { symbol, relation, value: formatNumber(trigger.value, locale, TWO), currency: quoteCurrency(symbol) })
        : t('describe.conditionChange', { symbol, relation, value: formatPercent(trigger.value, locale, { ...TWO, signDisplay: 'exceptZero' }) });
    const size = action.amountCad !== undefined
        ? cad(action.amountCad, locale)
        : t('describe.sizeUnits', { count: action.quantity ?? 0, quantity: formatNumber(action.quantity ?? 0, locale, { maximumFractionDigits: 6 }) });
    // A repeating rule is checked every minute but the engine lets it act once per market day
    return t('describe.sentence', { condition, side: action.side === 'buy' ? 'add' : 'reduce', size, frequency: once ? 'once' : 'repeat' });
}
