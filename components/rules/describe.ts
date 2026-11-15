// A rule in plain words. The same sentence is the preview before saving and the rule's stored wording.

import type { InvestmentRule } from '@/lib/domain/types';

export type RuleDraft = Pick<InvestmentRule, 'symbol' | 'trigger' | 'action' | 'once'>;

export const TRIGGER_LABELS: Record<InvestmentRule['trigger']['type'], string> = {
    price_below: 'Price below',
    price_above: 'Price above',
    change_pct_below: 'Day change below',
    change_pct_above: 'Day change above',
};

export const isPriceTrigger = (type: InvestmentRule['trigger']['type']) => type === 'price_below' || type === 'price_above';

/** The currency a price trigger is read in: the asset's quote currency (USD for US listings, CAD for .TO and crypto). */
export const quoteCurrency = (symbol: string) => (/\.TO$/i.test(symbol) || /^(BTC|ETH)$/i.test(symbol) ? 'CAD' : 'USD');

const fixed2 = (value: number) => value.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "When AAPL is below 150.00 USD, simulate a purchase of 500.00 CAD, once." */
export function describeRule({ symbol, trigger, action, once }: RuleDraft): string {
    const relation = trigger.type.endsWith('below') ? 'below' : 'above';
    const condition = isPriceTrigger(trigger.type)
        ? `${symbol} is ${relation} ${fixed2(trigger.value)} ${quoteCurrency(symbol)}`
        : `the day change of ${symbol} is ${relation} ${trigger.value > 0 ? '+' : ''}${fixed2(trigger.value)}%`;
    const size = action.amountCad !== undefined
        ? `${fixed2(action.amountCad)} CAD`
        : `${action.quantity} ${action.quantity === 1 ? 'unit' : 'units'}`;
    const what = action.side === 'buy' ? 'simulate a purchase of' : 'simulate a position reduction of';
    // A repeating rule is checked every minute but the engine lets it act once per market day
    return `When ${condition}, ${what} ${size}, ${once ? 'once' : 'at most once per market day while it stays true'}.`;
}
