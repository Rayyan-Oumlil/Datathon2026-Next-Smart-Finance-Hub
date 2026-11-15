import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_SCOPE } from '@/__tests__/test-user';
import { listScopeDecisions } from '@/lib/session';
import { apply, cancel, getAction, route, ruleSentence, undo } from '@/lib/agent/router';
import { getLayout } from '@/lib/services/layout';
import { getPortfolioState } from '@/lib/services/portfolio';
import { getProfile } from '@/lib/services/profile';
import { createRule, listRules } from '@/lib/services/rules-engine';
import { listDecisions, readState } from '@/lib/store';
import { containsNeverWord } from '@/lib/watchlist/reasons';
import { freshWorld, market, sourced } from '../services/helpers';

vi.mock('@/lib/services/quotes', async (original) => (await import('../services/market-stub')).quotesMock(await original()));

beforeEach(() => freshWorld());

const rule = { text: 'under 90 add 200 CAD of AAPL', symbol: 'AAPL', trigger: { type: 'price_below', value: 90 }, action: { side: 'buy', amountCad: 200 }, once: true };
const propose = (type: string, params: unknown, extra: object = {}) => ({ type, summary: 'from the model', params, needsConfirm: false, ...extra });
const preview = async (actionId: string, type: string, params: unknown) => {
    const routed = await route(actionId, propose(type, params));
    if (routed.outcome !== 'preview') throw new Error(`expected a preview, got ${JSON.stringify(routed)}`);
    return routed;
};

describe('whitelist and params', () => {
    it('passes no proposal through as none', async () => {
        expect(await route('a0', undefined)).toEqual({ outcome: 'none' });
    });

    it('drops a type that is not on the whitelist, and stores nothing', async () => {
        for (const type of ['real_trade', 'delete_profile', 'constructor', '']) {
            expect(await route('a1', propose(type, {}))).toMatchObject({ outcome: 'dropped', type });
        }
        expect(await route('a1', 'buy everything')).toMatchObject({ outcome: 'dropped' });
        expect((await readState(TEST_SCOPE)).pendingPreviews).toEqual([]);
    });

    it('drops params that do not pass the schema of their type', async () => {
        const bad: Array<[string, unknown]> = [
            ['lookup', { symbols: [] }],
            ['lookup', { symbols: ['AAPL'], extra: 1 }],
            ['explain_pick', {}],
            ['layout_change', { layout: 'holdings' }],
            ['layout_change', { layout: ['total_value', 'nope'] }],                             // unknown widget
            ['layout_change', { layout: ['holdings'] }],                                        // fixed widgets removed
            ['rule_create', { rule: { ...rule, trigger: { type: 'moon', value: 1 } } }],
            ['rule_create', { rule: { ...rule, symbol: 'NOPE' } }],
            ['rule_pause', { ruleId: 'rule_x', status: 'deleted' }],
            ['rule_pause', { ruleId: 'rule_missing', status: 'paused' }],
            ['profile_change', { changes: { risk: 'Extreme' } }],
            ['profile_change', { changes: { userId: 'someone-else' } }],
            ['simulated_trade', { symbol: 'AAPL', side: 'buy' }],
            ['simulated_trade', { symbol: 'AAPL', side: 'buy', amountCad: 100, quantity: 1 }],
            ['simulated_trade', { symbol: 'AAPL', side: 'short', amountCad: 100 }],
            ['simulated_trade', { symbol: 'AAPL', side: 'buy', amountCad: 99999 }],             // more than the cash
            ['simulated_trade', { symbol: 'GOLD', side: 'buy', amountCad: 100 }],               // reference value
            ['simulated_trade', { symbol: 'AAPL', side: 'sell', quantity: 1 }],                 // nothing held
        ];
        for (const [type, params] of bad) {
            const routed = await route('a2', propose(type, params));
            expect(routed, `${type} ${JSON.stringify(params)}`).toMatchObject({ outcome: 'dropped', type });
        }
        expect((await readState(TEST_SCOPE)).pendingPreviews).toEqual([]);
    });

    it('lets read-only actions through without a preview, and decides needsConfirm itself', async () => {
        expect(await route('a3', propose('lookup', { symbols: ['AAPL'] }))).toMatchObject({ outcome: 'info', proposed: { type: 'lookup', needsConfirm: false } });
        expect(await route('a3', propose('explain_pick', { symbol: 'AAPL' }))).toMatchObject({ outcome: 'info' });
        const routed = await route('a4', propose('simulated_trade', { symbol: 'aapl', side: 'buy', amountCad: 142, quantity: null }, { needsConfirm: false }));
        expect(routed).toMatchObject({ outcome: 'preview', proposed: { needsConfirm: true, params: { symbol: 'AAPL' } } });
    });

    it('applies nothing without a pending preview, and nothing twice', async () => {
        await expect(apply('missing')).rejects.toMatchObject({ status: 404 });
        await preview('a5', 'layout_change', { layout: ['total_value'] });
        await apply('a5');
        await expect(apply('a5')).rejects.toMatchObject({ status: 409 });
        await preview('a6', 'layout_change', { layout: ['total_value', 'holdings'] });
        await cancel('a6');
        await expect(apply('a6')).rejects.toMatchObject({ status: 409 });
        await expect(undo('a6')).rejects.toMatchObject({ status: 409 });
    });
});

describe('preview, apply, undo', () => {
    it('layout_change', async () => {
        const before = (await getLayout()).layout;
        const after = ['holdings', 'total_value'];
        const routed = await preview('l1', 'layout_change', { layout: after });
        expect(routed.preview).toMatchObject({ before, after });
        expect(routed.preview.summary).toContain('removes Performance chart');
        expect((await getLayout()).saved).toBe(false);          // a preview changes nothing

        expect(await apply('l1')).toMatchObject({ applied: true, undoable: true, before, after });
        expect(await getLayout()).toMatchObject({ layout: after, saved: true });
        expect(await undo('l1')).toMatchObject({ restored: true });
        expect(await getLayout()).toMatchObject({ layout: before, saved: false });
        expect((await getAction('l1'))?.status).toBe('undone');
    });

    it('layout_change hides an Overview panel such as the heatmap, shows it again, and undoes either', async () => {
        const all = (await getLayout()).layout;
        expect(all).toContain('overview_heatmap');
        const without = all.filter((id) => id !== 'overview_heatmap');

        const hide = await preview('h1', 'layout_change', { layout: without });
        expect(hide.preview.summary).toContain('removes Heatmap (Overview)');
        expect(hide.preview.rows.find((row) => row.label === 'Overview tab')?.after).not.toContain('Heatmap');
        expect(hide.preview.rows.find((row) => row.label === 'Overview tab')?.before).toContain('Heatmap');
        expect((await getLayout()).layout).toContain('overview_heatmap');          // a preview changes nothing
        await apply('h1');
        expect((await getLayout()).layout).not.toContain('overview_heatmap');

        const show = await preview('h2', 'layout_change', { layout: all });
        expect(show.preview.summary).toContain('adds Heatmap (Overview)');
        await apply('h2');
        expect((await getLayout()).layout).toContain('overview_heatmap');

        // Undoing the second change hides it again; undoing the first brings back the original state
        await undo('h2');
        expect((await getLayout()).layout).not.toContain('overview_heatmap');
        await undo('h1');
        expect((await getLayout()).layout).toContain('overview_heatmap');
    });

    it('rule_create', async () => {
        const routed = await preview('r1', 'rule_create', { rule: { ...rule, status: 'active' } });
        expect(routed.preview.rows[0].after).toBe('When the price of AAPL is below 90.00 USD, simulate a purchase of 200.00 CAD of AAPL, one time only.');
        expect(routed.preview.facts[0]).toMatchObject({ label: 'AAPL last price', value: '100.00 USD', source: 'stub quotes' });
        expect(await listRules()).toEqual([]);

        const applied = await apply('r1');
        const rules = await listRules();
        expect(rules).toHaveLength(1);
        expect(applied).toMatchObject({ applied: true, result: { rule: { id: rules[0].id, status: 'active' } } });
        expect(await undo('r1')).toMatchObject({ restored: true, result: { removed: true } });
        expect(await listRules()).toEqual([]);
        const actions = (await listScopeDecisions(TEST_SCOPE, { kind: 'user_action' })).map((row) => (row.payload as { action: string }).action);
        expect(actions).toEqual(['rule_create', 'rule_remove']);
    });

    it('rule_pause', async () => {
        const created = await createRule(rule);
        const routed = await preview('p1', 'rule_pause', { ruleId: created.id, status: 'paused' });
        expect(routed.preview).toMatchObject({ before: { status: 'active' }, after: { status: 'paused' } });
        await apply('p1');
        expect((await listRules())[0].status).toBe('paused');
        await undo('p1');
        expect((await listRules())[0].status).toBe('active');
    });

    it('profile_change', async () => {
        const start = (await getProfile())!;
        const routed = await preview('f1', 'profile_change', { changes: { risk: 'High', sectors: ['Energy'] } });
        expect(routed.preview.before).toEqual({ level: 'Intermediate', risk: 'Medium', answers: { sectors: ['Information Technology', 'Energy'] } });
        expect(routed.preview.after).toEqual({ level: 'Intermediate', risk: 'High', answers: { sectors: ['Energy'] } });
        expect((await getProfile())!.risk).toBe('Medium');

        await apply('f1');
        expect(await getProfile()).toMatchObject({ risk: 'High', riskOverridden: true, answers: { sectors: ['Energy'] } });
        await undo('f1');
        expect(await getProfile()).toMatchObject({ risk: 'Medium', riskOverridden: false, level: start.level, answers: start.answers });
    });

    it('profile_change preview uses the onboarding wording, never the stored field names or values', async () => {
        const start = (await getProfile())!;
        const routed = await preview('f2', 'profile_change', { changes: { drop20: start.answers.drop20 === 'sell' ? 'buy_more' : 'sell' } });
        const row = routed.preview.rows.find((r) => r.label === 'If it dropped 20%')!;
        expect([row.before, row.after]).toContain('Reduce my position');
        const shownText = [routed.preview.summary, ...routed.preview.rows.flatMap((r) => [r.label, r.before, r.after])].join(' | ');
        expect(shownText).not.toMatch(/drop20|buy_more|\bsell\b/);
        expect(containsNeverWord(shownText)).toBe(false);
    });

    it('simulated_trade: the undo is a compensating trade at the price then, and both stay in the log', async () => {
        const routed = await preview('t1', 'simulated_trade', { symbol: 'AAPL', side: 'buy', amountCad: 142 });
        expect(routed.conflicts).toEqual([]);
        expect(routed.preview).toMatchObject({ before: { cashCad: 10000, quantity: 0 }, after: { cashCad: 9858, quantity: 1 } });
        expect(routed.preview.facts[0]).toMatchObject({ value: '100.00 USD', source: 'stub quotes' });
        expect((await getPortfolioState()).trades).toEqual([]);

        expect(await apply('t1')).toMatchObject({ applied: true, undoable: true, result: { trade: { symbol: 'AAPL', side: 'buy', quantity: 1, origin: 'agent', simulated: true } } });
        market.prices.AAPL = { value: 110, currency: 'USD' };
        const undone = await undo('t1');
        expect(undone).toMatchObject({ restored: true, result: { trade: { side: 'sell', quantity: 1 } } });
        const portfolio = await getPortfolioState();
        expect(portfolio.positions).toEqual([]);
        expect(portfolio.cashCad).toBe(10014.2);                // 9858 + 1 x 110 x 1.42
        expect(portfolio.trades.map((trade) => trade.reason)).toEqual([
            'simulated purchase from the agent (action t1)',
            expect.stringContaining('undo of simulated trade'),
        ]);
        expect(await listScopeDecisions(TEST_SCOPE, { kind: 'simulated_trade' })).toHaveLength(2);
    });

    it('simulated_trade with a profile conflict: the preview names it, and the confirmed trade is acknowledged', async () => {
        market.signals.AAPL = { volatility1y: sourced(0.6, { source: 'derived' }) };
        const routed = await preview('t2', 'simulated_trade', { symbol: 'AAPL', side: 'buy', amountCad: 142 });
        expect(routed.conflicts).toMatchObject([{ filter: 'volatility', pass: false }]);
        expect(routed.conflicts[0].detail).toContain('60.0%');
        expect(await listScopeDecisions(TEST_SCOPE, { kind: 'profile_conflict' })).toEqual([]);     // a preview logs no decision

        expect(await apply('t2')).toMatchObject({ applied: true });
        const [conflict] = await listScopeDecisions(TEST_SCOPE, { kind: 'profile_conflict' });
        expect(conflict.payload).toMatchObject({ acknowledged: true, proceeded: true, origin: 'agent' });
    });

    it('simulated_trade: a conflict the preview did not show stops the apply', async () => {
        await preview('t3', 'simulated_trade', { symbol: 'AAPL', side: 'buy', amountCad: 142 });
        market.signals.AAPL = { volatility1y: sourced(0.6, { source: 'derived' }) };
        const outcome = await apply('t3');
        expect(outcome).toMatchObject({ applied: false, undoable: false });
        expect(outcome.message).toContain('60.0%');
        expect((await getPortfolioState()).trades).toEqual([]);
    });
});

describe('wording', () => {
    it('writes rule sentences and previews without a never-word', async () => {
        const sentences = [
            ruleSentence({ symbol: 'AAPL', trigger: { type: 'price_above', value: 10 }, action: { side: 'sell', quantity: 2 }, once: false }, 'USD'),
            ruleSentence({ symbol: 'AAPL', trigger: { type: 'change_pct_below', value: -5 }, action: { side: 'buy', amountCad: 50 }, once: true }),
            (await preview('w1', 'simulated_trade', { symbol: 'AAPL', side: 'buy', amountCad: 142 })).preview.summary,
            (await preview('w2', 'layout_change', { layout: ['total_value'] })).preview.summary,
        ];
        for (const sentence of sentences) expect(containsNeverWord(sentence), sentence).toBe(false);
        expect(sentences[0]).toBe('When the price of AAPL is above 10.00 USD, reduce the simulated position in AAPL by 2 units, at most once per market day.');
    });
});
