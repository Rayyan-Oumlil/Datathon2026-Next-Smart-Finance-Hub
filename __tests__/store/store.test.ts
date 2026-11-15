import { beforeEach, describe, expect, it } from 'vitest';
import type { ProfileConfig } from '@/lib/domain/types';
import * as store from '@/lib/store';
import { AlreadyExistsError, getBackend, tables } from '@/lib/store/client';
import { CHUNK_BYTES } from '@/lib/store/decision-log';
import { resetMemoryStore } from '@/lib/store/memory';

const user = 'test-user';

beforeEach(() => resetMemoryStore());

describe('append-only logs', () => {
    it('exports no way to update or delete', () => {
        expect(Object.keys(store).filter((name) => /update|delete|remove|put/i.test(name)).sort())
            .toEqual(['putProfile', 'updateState']);
        expect(Object.keys(getBackend()).sort()).toEqual(['get', 'put', 'putIfVersion', 'putNew', 'query']);
    });

    it('rejects a second write with the same id and keeps the first row', async () => {
        const first = await store.appendDecision({ userId: user, kind: 'user_action', payload: { action: 'pin' } });
        await expect(getBackend().putNew(tables.decisionLog(), { ...first, payload: { action: 'changed' } }))
            .rejects.toBeInstanceOf(AlreadyExistsError);
        expect((await store.getDecision(user, first.id))?.payload).toEqual({ action: 'pin' });

        const step = await store.appendAgentAction({ userId: user, actionId: 'a1', step: 'chat_input', actor: 'web' });
        await expect(getBackend().putNew(tables.agentActionLog(), { ...step, actor: 'changed' }))
            .rejects.toBeInstanceOf(AlreadyExistsError);
        expect((await store.listAgentActions(user))[0].actor).toBe('web');
    });

    it('refuses the overwriting put on either log table', async () => {
        const first = await store.appendDecision({ userId: user, kind: 'user_action', payload: { action: 'pin' } });
        await expect(getBackend().put(tables.decisionLog(), { ...first, payload: 'changed' })).rejects.toThrow(/append-only/);
        const step = await store.appendAgentAction({ userId: user, actionId: 'a1', step: 'chat_input', actor: 'web' });
        await expect(getBackend().put(tables.agentActionLog(), { ...step, actor: 'changed' })).rejects.toThrow(/append-only/);
        expect((await store.getDecision(user, first.id))?.payload).toEqual({ action: 'pin' });
        expect((await store.listAgentActions(user))[0].actor).toBe('web');
    });

    it('sorts rows by their real time whatever ISO form the caller gave, and rejects a time that is not a date', async () => {
        await store.appendDecision({ userId: user, kind: 'pick', payload: 'later', at: '2026-11-14T10:00:00.500Z' });
        const early = await store.appendDecision({ userId: user, kind: 'pick', payload: 'earlier', at: '2026-11-14T10:00:00Z' });
        await store.appendDecision({ userId: user, kind: 'pick', payload: 'earliest', at: '2026-11-14T05:59:59-04:00' });
        expect(early.at).toBe('2026-11-14T10:00:00.000Z');
        expect((await store.listDecisions(user)).map((entry) => entry.payload)).toEqual(['earliest', 'earlier', 'later']);

        await store.appendAgentAction({ userId: user, actionId: 'a1', step: 'result', actor: 'web', at: '2026-11-14T10:00:00.500Z' });
        await store.appendAgentAction({ userId: user, actionId: 'a1', step: 'chat_input', actor: 'web', at: '2026-11-14T10:00:00Z' });
        expect((await store.listAgentActions(user, { actionId: 'a1' })).map((row) => row.step)).toEqual(['chat_input', 'result']);

        await expect(store.appendDecision({ userId: user, kind: 'pick', payload: 1, at: 'yesterday' })).rejects.toThrow(/not a valid date/);
        await expect(store.appendAgentAction({ userId: user, actionId: 'a1', step: 'error', actor: 'web', at: '' })).rejects.toThrow(/not a valid date/);
        expect(await store.listDecisions(user)).toHaveLength(3);
    });

    it('gives ids made of the time, a # and 8 hex characters', async () => {
        const made = await store.appendDecision({ userId: user, kind: 'pick', payload: 1, at: '2026-11-14T10:00:00.000Z' });
        expect(made.at).toBe('2026-11-14T10:00:00.000Z');
        expect(made.id).toMatch(/^2026-11-14T10:00:00\.000Z#[0-9a-f]{8}$/);
    });
});

describe('decision log', () => {
    it('lists in the order written, or newest first, with a limit', async () => {
        for (let n = 0; n < 5; n++) await store.appendDecision({ userId: user, kind: 'pick', payload: n });
        await store.appendDecision({ userId: 'someone-else', kind: 'pick', payload: 99 });

        expect((await store.listDecisions(user)).map((entry) => entry.payload)).toEqual([0, 1, 2, 3, 4]);
        expect((await store.listDecisions(user, { newestFirst: true, limit: 2 })).map((entry) => entry.payload)).toEqual([4, 3]);
        expect((await store.listDecisions(user, { limit: 2 })).map((entry) => entry.payload)).toEqual([0, 1]);
    });

    it('filters by kind, symbol and snapshot', async () => {
        await store.appendDecision({ userId: user, kind: 'watchlist_run', snapshotId: 's1', payload: 'run1' });
        await store.appendDecision({ userId: user, kind: 'pick', snapshotId: 's1', symbol: 'AAPL', payload: 'p1' });
        await store.appendDecision({ userId: user, kind: 'pick', snapshotId: 's2', symbol: 'AAPL', payload: 'p2' });
        await store.appendDecision({ userId: user, kind: 'pick', snapshotId: 's2', symbol: 'RY.TO', payload: 'p3' });

        const payloads = async (query: store.DecisionQuery) => (await store.listDecisions(user, query)).map((entry) => entry.payload);
        expect(await payloads({ kind: 'pick' })).toEqual(['p1', 'p2', 'p3']);
        expect(await payloads({ symbol: 'AAPL' })).toEqual(['p1', 'p2']);
        expect(await payloads({ snapshotId: 's1' })).toEqual(['run1', 'p1']);
        expect(await payloads({ kind: 'pick', symbol: 'AAPL', snapshotId: 's2' })).toEqual(['p2']);
        expect(await payloads({ kind: 'simulated_trade' })).toEqual([]);
    });

    it('returns null for an id that does not exist', async () => {
        expect(await store.getDecision(user, 'nope')).toBeNull();
    });

    it('drops undefined fields and stores plain data', async () => {
        const made = await store.appendDecision({ userId: user, kind: 'pick', symbol: undefined, payload: { a: undefined, b: 1 } });
        expect(made).not.toHaveProperty('symbol');
        expect(await store.getDecision(user, made.id)).toEqual(made);
        expect(made.payload).toEqual({ b: 1 });
    });

    it('splits a large payload into chunk rows and puts it back together', async () => {
        // About 1 MB, with multi-byte characters so a cut can land inside one
        const payload = { signals: Array.from({ length: 12000 }, (_, i) => ({ symbol: `S${i}`, note: 'échéance — 5 % ✓', closes: [i, i + 0.5, i * 1.25] })) };
        const bytes = Buffer.byteLength(JSON.stringify(payload));
        expect(bytes).toBeGreaterThan(3 * CHUNK_BYTES);

        const before = await store.appendDecision({ userId: user, kind: 'pick', payload: 'before' });
        const big = await store.appendDecision({ userId: user, kind: 'watchlist_run', snapshotId: 's1', ruleVersions: { score: 'v1' }, payload });
        const after = await store.appendDecision({ userId: user, kind: 'pick', payload: 'after' });
        expect(big.payload).toEqual(payload);

        const rows = await getBackend().query({ table: tables.decisionLog(), keyName: 'userId', keyValue: user });
        const chunks = rows.filter((row) => row.chunk !== undefined);
        expect(chunks.length).toBe(Math.ceil(bytes / CHUNK_BYTES));
        for (const row of chunks) {
            expect(Buffer.byteLength(JSON.stringify(row))).toBeLessThan(400_000);
            expect(row).toMatchObject({ kind: 'watchlist_run', snapshotId: 's1', chunkOf: big.id });
        }
        expect(rows.find((row) => row.id === big.id)).not.toHaveProperty('payload');

        expect(await store.getDecision(user, big.id)).toEqual(big);
        expect(await store.getDecision(user, String(chunks[0].id))).toBeNull();
        expect((await store.listDecisions(user)).map((entry) => entry.id)).toEqual([before.id, big.id, after.id]);
        expect(await store.listDecisions(user, { kind: 'watchlist_run' })).toEqual([big]);
        expect(await store.listDecisions(user, { snapshotId: 's1', newestFirst: true, limit: 1 })).toEqual([big]);
    });

    it('keeps a payload at the size limit in one row and chunks one byte more', async () => {
        const rowsFor = async (payload: string) => {
            resetMemoryStore();
            const made = await store.appendDecision({ userId: user, kind: 'pick', payload });
            expect(await store.getDecision(user, made.id)).toEqual(made);
            return (await getBackend().query({ table: tables.decisionLog(), keyName: 'userId', keyValue: user })).length;
        };
        // The JSON of a string is the string plus two quotes
        expect(await rowsFor('x'.repeat(CHUNK_BYTES - 2))).toBe(1);
        expect(await rowsFor('x'.repeat(CHUNK_BYTES - 1))).toBe(3);     // two chunks and the head
    });

    it('fails loudly, for get and list, when a chunk of a stored entry is missing', async () => {
        const table = tables.decisionLog();
        const head = { userId: user, id: '2026-11-14T10:00:00.000Z#00000000', at: '2026-11-14T10:00:00.000Z', kind: 'pick', chunks: 2 };
        await getBackend().putNew(table, { ...head, id: `${head.id}#chunk-0000`, chunk: 0, chunkOf: head.id, data: '"ha' });
        await getBackend().putNew(table, head);
        await expect(store.getDecision(user, head.id)).rejects.toThrow(/expected 2 payload chunks, found 1/);
        await expect(store.listDecisions(user)).rejects.toThrow(/expected 2 payload chunks, found 1/);
    });

    it('ignores chunks whose head row was never written', async () => {
        await getBackend().putNew(tables.decisionLog(), { userId: user, id: 'x#chunk-0000', kind: 'pick', chunk: 0, chunkOf: 'x', data: '"half' });
        expect(await store.listDecisions(user)).toEqual([]);
        expect(await store.getDecision(user, 'x')).toBeNull();
    });
});

describe('agent action log', () => {
    it('keeps the steps of a request in order and reads one request by its action id', async () => {
        const steps = ['chat_input', 'context_built', 'orchestrator_call', 'result'] as const;
        for (const step of steps) await store.appendAgentAction({ userId: user, actionId: 'a1', step, actor: 'web' });
        await store.appendAgentAction({ userId: user, actionId: 'a2', step: 'chat_input', actor: 'web', before: { x: 1 }, after: { x: 2 } });
        await store.appendAgentAction({ userId: 'someone-else', actionId: 'a1', step: 'error', actor: 'web' });

        expect((await store.listAgentActions(user)).map((row) => row.actionId)).toEqual(['a1', 'a1', 'a1', 'a1', 'a2']);
        expect((await store.listAgentActions(user, { actionId: 'a1' })).map((row) => row.step)).toEqual([...steps]);
        expect((await store.listAgentActions(user, { actionId: 'a1', newestFirst: true, limit: 1 })).map((row) => row.step)).toEqual(['result']);
        expect((await store.listAgentActions(user, { actionId: 'a2' }))[0]).toMatchObject({ before: { x: 1 }, after: { x: 2 } });
    });
});

describe('profile', () => {
    it('is null until saved, and a later save overwrites', async () => {
        expect(await store.getProfile(user)).toBeNull();
        const profile = { userId: user, level: 'Novice', risk: 'Low', updatedAt: '2026-11-14T10:00:00.000Z' } as ProfileConfig;
        await store.putProfile(profile);
        expect(await store.getProfile(user)).toEqual(profile);
        await store.putProfile({ ...profile, level: 'Expert', updatedAt: '2026-11-14T11:00:00.000Z' });
        expect(await store.getProfile(user)).toMatchObject({ level: 'Expert', updatedAt: '2026-11-14T11:00:00.000Z' });
    });
});

describe('app state', () => {
    const scope = { scopeId: 'test-user:p0:f0' };
    beforeEach(() => resetMemoryStore());

    it('starts empty when nothing is stored', async () => {
        expect(await store.readState(scope)).toEqual({
            rules: [],
            layout: null,
            watchlist: { listedSince: {}, pinned: [], dismissed: [], previousPicks: [] },
            pendingPreviews: [],
        });
    });

    it('saves what an update changes, in place or returned', async () => {
        await store.updateState(scope, (state) => { state.watchlist.pinned.push('AAPL'); });
        await store.updateState(scope, (state) => ({ ...state, layout: { widgets: [{ slot: 'a', widget: 'total_value' }], updatedAt: 'now' } }));
        const saved = await store.readState(scope);
        expect(saved.watchlist.pinned).toEqual(['AAPL']);
        expect(saved.layout?.widgets).toEqual([{ slot: 'a', widget: 'total_value' }]);
    });

    it('loses no write when many updates run at once', async () => {
        const symbols = Array.from({ length: 6 }, (_, i) => `S${i}`);
        await Promise.all(symbols.map((symbol) => store.updateState(scope, (state) => { state.watchlist.dismissed.push(symbol); })));
        expect((await store.readState(scope)).watchlist.dismissed.sort()).toEqual([...symbols].sort());
    });

    it('keeps two scopes apart', async () => {
        await store.updateState(scope, (state) => { state.watchlist.pinned.push('AAPL'); });
        expect((await store.readState({ scopeId: 'other:p0:f0' })).watchlist.pinned).toEqual([]);
    });

    it('keeps working after an update that throws', async () => {
        await expect(store.updateState(scope, () => { throw new Error('bad'); })).rejects.toThrow('bad');
        await store.updateState(scope, (state) => { state.watchlist.pinned.push('RY.TO'); });
        expect((await store.readState(scope)).watchlist.pinned).toEqual(['RY.TO']);
    });
});
