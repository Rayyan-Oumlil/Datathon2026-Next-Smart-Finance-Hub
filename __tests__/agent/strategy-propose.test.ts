import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_SCOPE } from '@/__tests__/test-user';
import { apply, route, undo } from '@/lib/agent/router';
import { simulateTrade } from '@/lib/services/portfolio';
import { listStrategies } from '@/lib/services/rules-engine';
import { readState } from '@/lib/store';
import { freshWorld } from '../services/helpers';

vi.mock('@/lib/services/quotes', async (original) => (await import('../services/market-stub')).quotesMock(await original()));

beforeEach(() => freshWorld());

const strategy = {
    name: 'Prudente',
    rules: [
        { kind: 'allocation_target', targets: [{ symbol: 'AAPL', weightPct: 60 }], rebalance: { mode: 'quarterly' } },
        { kind: 'drawdown_guard', triggerDrawdownPct: 15, movePct: 50, defensiveSymbol: 'XBB.TO', recoverDrawdownPct: 5 },
    ],
};
const propose = (params: unknown) => ({ type: 'strategy_propose', summary: 'from the model', params, needsConfirm: true });

describe('strategy_propose', () => {
    it('refuses an invalid strategy with its issue codes and stores nothing', async () => {
        const bad = { ...strategy, rules: [{ ...strategy.rules[1], triggerDrawdownPct: 95 }], colour: 'red' };
        const routed = await route('s0', propose({ strategy: bad }), 'fr', TEST_SCOPE);
        expect(routed).toMatchObject({ outcome: 'dropped', type: 'strategy_propose' });
        if (routed.outcome !== 'dropped') throw new Error('expected a refusal');
        expect(routed.detail).toContain('unknown_field@colour');
        expect(routed.reason).toContain('La stratégie ne peut pas être proposée');
        expect((await readState(TEST_SCOPE)).pendingPreviews).toEqual([]);
    });

    it('previews a valid strategy with its sentences and the replay, applies it, and undo removes it', async () => {
        await simulateTrade({ symbol: 'AAPL', side: 'buy', amountCad: 1000, origin: 'card' }, 'en', TEST_SCOPE);
        const routed = await route('s1', propose({ strategy }), 'en', TEST_SCOPE);
        if (routed.outcome !== 'preview') throw new Error(`expected a preview, got ${JSON.stringify(routed)}`);
        const view = routed.preview.strategy!;
        expect(view.sentences[0]).toContain('Target weights: AAPL 60%');
        expect(view.sentences[1]).toContain('XBB.TO');
        expect(view.illustrative).toBe('Illustrative replay on historical data. This is not a prediction.');
        expect(view.replay === null ? view.replayNote : view.table.map((row) => row.label)).toBeTruthy();

        const applied = await apply('s1', 'en', TEST_SCOPE);
        expect(applied).toMatchObject({ applied: true, undoable: true });
        const saved = await listStrategies(TEST_SCOPE);
        expect(saved).toHaveLength(1);
        expect((applied.result as { timeMachine: string }).timeMachine).toBe(`/time-machine?strategy=${saved[0].id}`);

        expect(await undo('s1', 'en', TEST_SCOPE)).toMatchObject({ restored: true });
        expect(await listStrategies(TEST_SCOPE)).toEqual([]);
        expect(((await readState(TEST_SCOPE)) as unknown as { strategiesRemoved: Array<{ id: string }> }).strategiesRemoved[0].id).toBe(saved[0].id);
    });
});
