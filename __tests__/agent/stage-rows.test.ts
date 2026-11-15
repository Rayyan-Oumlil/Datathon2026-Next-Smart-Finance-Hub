import { describe, expect, it } from 'vitest';
import { rowsForStage, type AuditRow } from '@/lib/agent/stage-rows';
import type { StageLine } from '@/lib/agent/stages';

const line = (stage: StageLine['stage'], name?: string): StageLine => ({ key: `${stage}${name ?? ''}`, stage, name, state: 'done', ok: true });
const row = (id: string, step: string, actor = 'orchestrator', dataUsed?: unknown): AuditRow => ({ id, step, actor, dataUsed });

// Rows as the log holds them, oldest first: two orchestrator calls, a specialist, a tool, a failed check, a retry
const rows: AuditRow[] = [
    row('01', 'chat_input', 'web'),
    row('02', 'orchestrator_call'),
    row('03', 'tool_call', 'subagent:market_data', { endpoint: '/api/internal/tools/market-data' }),
    row('04', 'subagent_call', 'subagent:market_data'),
    row('05', 'subagent_call', 'subagent:market_data'),
    row('06', 'orchestrator_call'),
    row('07', 'guardrail_check', 'writer'),
    row('08', 'orchestrator_call'),
    row('09', 'guardrail_check', 'writer'),
    row('10', 'result', 'web'),
];
const ids = (found: AuditRow[]) => found.map((r) => r.id);

describe('rowsForStage', () => {
    it('gives the orchestrator calls made before the first check', () => {
        expect(ids(rowsForStage([line('orchestrator')], 0, rows))).toEqual(['02', '06']);
    });

    it('gives the calls of a retry, the ones between a failed check and the next', () => {
        const lines = [line('orchestrator'), line('guardrail'), line('retry'), line('guardrail')];
        expect(ids(rowsForStage(lines, 2, rows))).toEqual(['08']);
    });

    it('gives the model calls of one specialist', () => {
        expect(ids(rowsForStage([line('subagent', 'market_data')], 0, rows))).toEqual(['04', '05']);
    });

    it('gives the tool call that matches the name, in order when it was called twice', () => {
        const twice = [...rows, row('11', 'tool_call', 'subagent:market_data', { endpoint: '/api/internal/tools/market-data' })];
        const lines = [line('tool', 'market-data'), line('tool', 'market-data')];
        expect(ids(rowsForStage(lines, 0, twice))).toEqual(['03']);
        expect(ids(rowsForStage(lines, 1, twice))).toEqual(['11']);
    });

    it('also finds a tool call that failed', () => {
        const failed = [row('01', 'error', 'subagent:rules', { endpoint: '/api/internal/tools/validate-rule' })];
        expect(ids(rowsForStage([line('tool', 'validate-rule')], 0, failed))).toEqual(['01']);
    });

    it('gives the check of the same number, first or second', () => {
        const lines = [line('guardrail'), line('guardrail')];
        expect(ids(rowsForStage(lines, 0, rows))).toEqual(['07']);
        expect(ids(rowsForStage(lines, 1, rows))).toEqual(['09']);
    });

    it('gives the result row for a reply that came from the cache', () => {
        expect(ids(rowsForStage([line('cache')], 0, rows))).toEqual(['10']);
    });

    it('gives nothing when the rows are not there yet or do not match', () => {
        expect(rowsForStage([line('subagent', 'portfolio')], 0, rows)).toEqual([]);
        expect(rowsForStage([line('orchestrator')], 0, [])).toEqual([]);
        expect(rowsForStage([line('tool', 'layout')], 0, rows)).toEqual([]);
    });

    it('does not mistake a tool whose name ends the same way', () => {
        const near = [row('01', 'tool_call', 'x', { endpoint: '/api/internal/tools/portfolio-stats' })];
        expect(rowsForStage([line('tool', 'portfolio')], 0, near)).toEqual([]);
    });
});
