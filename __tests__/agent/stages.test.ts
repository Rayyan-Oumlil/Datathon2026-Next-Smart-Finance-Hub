import { describe, expect, it } from 'vitest';
import { applyStage, isStageEvent, type StageEvent, type StageLine } from '@/lib/agent/stages';

const run = (events: StageEvent[]) => events.reduce<StageLine[]>((lines, event) => applyStage(lines, event), []);

describe('applyStage', () => {
    it('opens a line on start and closes it on done, with the time taken', () => {
        const lines = run([{ type: 'stage', stage: 'subagent', name: 'portfolio', state: 'start' }, { type: 'stage', stage: 'subagent', name: 'portfolio', state: 'done', ok: true, ms: 840 }]);
        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatchObject({ stage: 'subagent', name: 'portfolio', state: 'done', ok: true, ms: 840 });
    });

    it('keeps a failed stage as not ok', () => {
        const lines = run([{ type: 'stage', stage: 'subagent', name: 'rules', state: 'start' }, { type: 'stage', stage: 'subagent', name: 'rules', state: 'done', ok: false, ms: 5 }]);
        expect(lines[0].ok).toBe(false);
    });

    it('closes the first open line of the same stage and name, not another one', () => {
        const lines = run([
            { type: 'stage', stage: 'tool', name: 'market-data', state: 'start' },
            { type: 'stage', stage: 'subagent', name: 'portfolio', state: 'start' },
            { type: 'stage', stage: 'tool', name: 'market-data', state: 'done', ok: true, ms: 120 },
        ]);
        expect(lines.map((l) => l.state)).toEqual(['done', 'running']);
    });

    it('adds a closed line for a done that had no start', () => {
        const lines = run([{ type: 'stage', stage: 'tool', name: 'layout', state: 'done', ok: true, ms: 9 }]);
        expect(lines).toEqual([expect.objectContaining({ stage: 'tool', name: 'layout', state: 'done', ok: true })]);
    });

    it('records whether a guardrail pass succeeded', () => {
        const lines = run([{ type: 'stage', stage: 'guardrail', state: 'start' }, { type: 'stage', stage: 'guardrail', state: 'done', attempt: 1, passed: false, ms: 300 }]);
        expect(lines[0].passed).toBe(false);
    });

    it('does not change the lines it was given', () => {
        const before = run([{ type: 'stage', stage: 'orchestrator', state: 'start' }]);
        const snapshot = JSON.stringify(before);
        applyStage(before, { type: 'stage', stage: 'orchestrator', state: 'done', ok: true });
        expect(JSON.stringify(before)).toBe(snapshot);
    });
});

describe('isStageEvent', () => {
    it('accepts a stage event and refuses anything else', () => {
        expect(isStageEvent({ type: 'stage', stage: 'guardrail', state: 'start' })).toBe(true);
        expect(isStageEvent({ type: 'heartbeat' })).toBe(false);
        expect(isStageEvent({ type: 'stage', stage: 'mystery', state: 'start' })).toBe(false);
        expect(isStageEvent({ type: 'stage', stage: 'tool', state: 'half' })).toBe(false);
        expect(isStageEvent(null)).toBe(false);
    });
});
