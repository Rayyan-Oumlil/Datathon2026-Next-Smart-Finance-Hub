import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_USER } from '@/lib/demo-user';
import { listDecisions } from '@/lib/store';
import { getPortfolioState, simulateTrade } from '@/lib/services/portfolio';
import { createRule, evaluateRules, listRules, setRuleStatus, validateRule } from '@/lib/services/rules-engine';
import { freshWorld, market, sourced } from './helpers';

vi.mock('@/lib/services/quotes', async (original) => (await import('./market-stub')).quotesMock(await original()));

beforeEach(() => freshWorld());

const below100 = { text: 'add 500 CAD of AAPL under 100', symbol: 'AAPL', trigger: { type: 'price_below', value: 100 }, action: { side: 'buy', amountCad: 500 }, once: true };
const errorsOf = async (rule: unknown) => {
    const checked = await validateRule(rule);
    return checked.ok ? [] : checked.errors;
};

describe('validateRule', () => {
    it('accepts a well-formed rule and returns the price it was checked against', async () => {
        const checked = await validateRule({ ...below100, symbol: 'aapl' });
        expect(checked).toMatchObject({ ok: true, rule: { symbol: 'AAPL', status: 'active', once: true }, currentPrice: { value: 100, source: 'stub quotes' } });
    });

    it('names each problem', async () => {
        expect((await errorsOf({ ...below100, symbol: 'NOPE' }))[0]).toContain('not in the app');
        expect((await errorsOf({ ...below100, symbol: 'GOLD' }))[0]).toContain('reference value');
        expect((await errorsOf({ ...below100, trigger: { type: 'price_below', value: 0 } }))[0]).toContain('above zero');
        expect((await errorsOf({ ...below100, trigger: { type: 'change_pct_below', value: 0 } }))[0]).toContain('% change');
        expect((await errorsOf({ ...below100, action: { side: 'buy' } }))[0]).toContain('either an amount');
        expect((await errorsOf({ ...below100, action: { side: 'buy', amountCad: 500, quantity: 1 } }))[0]).toContain('either an amount');
        expect((await errorsOf({ ...below100, action: { side: 'buy', amountCad: 10001 } }))[0]).toContain('Simulated cash is 10000.00 CAD');
        expect((await errorsOf({ ...below100, action: { side: 'buy', quantity: 100 } }))[0]).toContain('14200.00 CAD');      // 100 x 100 USD x 1.42
        expect((await errorsOf({ ...below100, action: { side: 'sell', quantity: 1 } }))[0]).toContain('holds no AAPL');
        expect((await errorsOf({ ...below100, text: ' ' }))[0]).toContain('text');
        expect((await errorsOf({ ...below100, action: { side: 'buy', amountCad: -5 } })).length).toBeGreaterThan(0);
        market.prices.MSFT = undefined;
        expect((await errorsOf({ ...below100, symbol: 'MSFT' }))[0]).toContain('No price is available');
        await expect(createRule({ ...below100, symbol: 'NOPE' })).rejects.toMatchObject({ status: 400 });
        expect(await listRules()).toEqual([]);
    });
});

describe('evaluateRules', () => {
    it('does nothing while the trigger is not met', async () => {
        const rule = await createRule(below100);           // price is 100: not below 100
        const { fired, checks } = await evaluateRules();
        expect(fired).toEqual([]);
        expect(checks).toEqual([expect.objectContaining({ ruleId: rule.id, hit: false, fired: false, note: 'price 100.00 USD was not below 100.00 USD' })]);
    });

    it('simulates a fill at the last price on a hit, with a factual reason, and fires a once-rule only once', async () => {
        const rule = await createRule(below100);
        market.prices.AAPL = { value: 98.2, currency: 'USD' };
        const { fired } = await evaluateRules();
        expect(fired).toEqual([expect.objectContaining({ symbol: 'AAPL', origin: 'rule', ruleId: rule.id, valueCad: 500, reason: `rule ${rule.id}: price 98.20 USD was below 100.00 USD`, simulated: true })]);
        expect(fired[0].price.value).toBe(98.2);
        expect((await getPortfolioState()).cashCad).toBe(9500);
        expect(await listRules()).toEqual([expect.objectContaining({ id: rule.id, status: 'paused', lastFiredAt: fired[0].at })]);

        expect((await evaluateRules()).fired).toEqual([]);
        // A once-rule that has fired cannot be resumed into an active rule that does nothing
        await expect(setRuleStatus(rule.id, 'active')).rejects.toMatchObject({ status: 409 });
        expect(await listRules()).toEqual([expect.objectContaining({ status: 'paused' })]);
        expect(await listDecisions(DEMO_USER.id, { kind: 'simulated_trade' })).toHaveLength(1);
    });

    it('does not fire at the trigger value itself, in either direction, and fires one cent past it', async () => {
        const above = await createRule({ ...below100, text: 'add 500 CAD of AAPL over 100', trigger: { type: 'price_above', value: 100 } });
        await createRule({ ...below100, once: false, trigger: { type: 'change_pct_above', value: 10 } });       // the change is 10%
        const at = await evaluateRules();
        expect(at.fired).toEqual([]);
        expect(at.checks.map((check) => check.note)).toEqual(['price 100.00 USD was not above 100.00 USD', 'change today 10.00% was not above 10.00%']);
        market.prices.AAPL = { value: 100.01, currency: 'USD', change: 10 };
        const past = await evaluateRules();
        expect(past.fired).toEqual([expect.objectContaining({ ruleId: above.id, reason: `rule ${above.id}: price 100.01 USD was above 100.00 USD` })]);
        expect(past.fired[0].price).toMatchObject({ value: 100.01, source: 'stub quotes', fetchedAt: expect.any(String) });
    });

    it('logs no conflict for a rule hit that cannot be simulated', async () => {
        const rule = await createRule({ ...below100, once: false, trigger: { type: 'price_above', value: 50 }, action: { side: 'buy', amountCad: 9000 } });
        market.signals.AAPL = { volatility1y: sourced(0.5, { source: 'derived' }) };
        await simulateTrade({ symbol: 'RY.TO', side: 'buy', amountCad: 5000 });         // leaves 5000: the rule's 9000 no longer fits
        const { fired, checks } = await evaluateRules();
        expect(fired).toEqual([]);
        expect(checks).toEqual([expect.objectContaining({ ruleId: rule.id, hit: true, fired: false })]);
        expect(await listDecisions(DEMO_USER.id, { kind: 'profile_conflict' })).toEqual([]);
    });

    it('fires a repeating rule at most once per market day', async () => {
        await createRule({ ...below100, once: false, trigger: { type: 'change_pct_above', value: 5 } });      // AAPL is +10% today
        const first = await evaluateRules();
        expect(first.fired[0].reason).toContain('change today 10.00% was above 5.00%');
        const second = await evaluateRules();
        expect(second.fired).toEqual([]);
        expect(second.checks[0].note).toBe('already fired today');
        expect((await listRules())[0].status).toBe('active');
    });

    it('skips paused rules, and reduces a position on a price_above rule', async () => {
        await simulateTrade({ symbol: 'RY.TO', side: 'buy', quantity: 10 });
        const paused = await createRule(below100);
        await setRuleStatus(paused.id, 'paused');
        const out = await createRule({ text: 'reduce RY above 55', symbol: 'RY.TO', trigger: { type: 'price_above', value: 55 }, action: { side: 'sell', quantity: 4 } });
        market.prices.AAPL = { value: 90, currency: 'USD' };
        market.prices['RY.TO'] = { value: 60, currency: 'CAD' };
        const { fired, checks } = await evaluateRules();
        expect(checks.map((check) => check.ruleId)).toEqual([out.id]);
        expect(fired).toEqual([expect.objectContaining({ symbol: 'RY.TO', side: 'sell', quantity: 4, valueCad: 240, reason: `rule ${out.id}: price 60.00 CAD was above 55.00 CAD` })]);
        expect((await getPortfolioState()).positions[0].quantity).toBe(6);
    });

    it('still simulates a rule trade that conflicts with the profile, and logs the conflict with it', async () => {
        const rule = await createRule(below100);
        market.prices.AAPL = { value: 95, currency: 'USD' };
        market.signals.AAPL = { volatility1y: sourced(0.5, { source: 'derived' }) };
        const { fired } = await evaluateRules();
        expect(fired).toHaveLength(1);
        expect(fired[0].reason).toContain('profile conflict logged: volatility');
        const [conflict] = await listDecisions(DEMO_USER.id, { kind: 'profile_conflict' });
        expect(conflict.payload).toMatchObject({ origin: 'rule', ruleId: rule.id, proceeded: true, acknowledged: false });
    });

    it('reports a hit it could not simulate and leaves the rule active', async () => {
        const rule = await createRule({ ...below100, action: { side: 'buy', amountCad: 9000 } });
        await simulateTrade({ symbol: 'RY.TO', side: 'buy', amountCad: 5000 });
        market.prices.AAPL = { value: 95, currency: 'USD' };
        const { fired, checks } = await evaluateRules();
        expect(fired).toEqual([]);
        expect(checks[0]).toMatchObject({ ruleId: rule.id, hit: true, fired: false });
        expect(checks[0].note).toContain('not simulated: Simulated cash is 5,000.00 CAD');
        expect((await listRules())[0]).toMatchObject({ status: 'active' });
    });

    it('logs rule creation and status changes', async () => {
        const rule = await createRule(below100);
        await setRuleStatus(rule.id, 'paused');
        await expect(setRuleStatus('rule_missing', 'paused')).rejects.toMatchObject({ status: 404 });
        const actions = (await listDecisions(DEMO_USER.id, { kind: 'user_action' })).map((entry) => (entry.payload as { action: string }).action);
        expect(actions).toEqual(['rule_create', 'rule_pause']);
    });
});
