import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { timelineComplete, timelineFromRows, toolName, type TimelineRow } from '@/lib/agent/timeline';

const row = (n: number, step: string, fields: Partial<TimelineRow> = {}): TimelineRow =>
    ({ id: `2026-11-15T14:00:0${n}.000Z#0000000${n}`, at: `2026-11-15T14:00:0${n}.000Z`, step, actor: 'web', ...fields });

const ROWS: TimelineRow[] = [
    row(3, 'tool_call', { actor: 'subagent:market_data', dataUsed: { endpoint: '/api/internal/tools/market-data', body: { symbols: ['MSFT'] } }, result: { ok: true } }),
    row(1, 'chat_input', { dataUsed: { message: 'cours de MSFT', historyTurns: 2 } }),
    row(2, 'context_built', { dataUsed: { risk: 'Medium', level: 'Novice', holdings: [{}, {}], watchlist: [{}] } }),
    row(4, 'guardrail_check', { actor: 'writer', result: { attempt: 1, passed: true } }),
    row(5, 'action_routed', { result: { outcome: 'none', type: null } }),
    row(6, 'result', { result: { refused: false, withheldByWordCheck: false, sources: 1 } }),
];

describe('timelineFromRows', () => {
    it('gives one item per row, oldest first, filled from the row fields only', () => {
        const items = timelineFromRows(ROWS);
        expect(items.map((i) => i.key)).toEqual(['chat_input', 'context_built', 'tool_call_symbols', 'guardrail_passed', 'action_none', 'result_reply']);
        expect(items[1].values).toEqual({ risk: 'Medium', level: 'Novice', holdings: 2, picks: 1 });
        expect(items[2].values).toEqual({ tool: 'market-data', symbols: 'MSFT' });
        expect(items[2].at).toBe('2026-11-15T14:00:03.000Z');
        expect(items[5].values).toEqual({ sources: 1 });
    });

    it('is deterministic: the same rows give the same items', () => {
        expect(timelineFromRows(ROWS)).toEqual(timelineFromRows([...ROWS].reverse()));
    });

    it('marks failures and skips a result row that repeats an applied change', () => {
        const items = timelineFromRows([
            row(1, 'guardrail_check', { result: { attempt: 1, passed: false } }),
            row(2, 'error', { dataUsed: { endpoint: '/api/internal/tools/portfolio' } }),
            row(3, 'applied'),
            row(4, 'result', { result: { applied: true } }),
            row(5, 'undo', { result: { restored: true } }),
            row(6, 'something_new'),
        ]);
        expect(items.map((i) => [i.key, Boolean(i.failed)])).toEqual([
            ['guardrail_failed', true], ['error_tool', true], ['applied', false], ['undo', false], ['unknown', false],
        ]);
    });

    it('reads the tool name and completeness', () => {
        expect(toolName('/api/internal/tools/conflict-check')).toBe('conflict-check');
        expect(timelineComplete(ROWS)).toBe(true);
        expect(timelineComplete(ROWS.slice(0, 3))).toBe(false);
    });

    it('has a sentence in both languages for every key it can give', () => {
        const keys = ['chat_input', 'context_built', 'context_built_noProfile', 'prompt_built', 'orchestrator_call', 'subagent_call', 'tool_call',
            'tool_call_symbols', 'guardrail_passed', 'guardrail_failed', 'action_preview', 'action_info', 'action_dropped', 'action_none', 'preview_shown',
            'confirmed', 'cancelled', 'applied', 'result_error', 'result_notApplied', 'result_cache', 'result_refused', 'result_reply', 'undo',
            'undo_failed', 'error_tool', 'error', 'unknown'];
        for (const locale of ['en', 'fr']) {
            const messages = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'messages', locale, 'AgentPanel.json'), 'utf8'));
            for (const key of keys) expect(messages.timeline.steps[key], `${locale}: timeline.steps.${key}`).toBeTypeOf('string');
        }
    });
});
