// What the panel shows while the agent works: one line per stage of the request. Pure, so it is tested alone.

export type StageName = 'orchestrator' | 'subagent' | 'tool' | 'guardrail' | 'retry' | 'cache';
export type StageEvent = {
    type: 'stage';
    stage: StageName;
    state: 'start' | 'done';
    name?: string;
    ok?: boolean;
    ms?: number;
    attempt?: number;
    passed?: boolean;
};
export type StageLine = { key: string; stage: StageName; name?: string; state: 'running' | 'done'; ok: boolean; passed?: boolean; ms?: number };

const STAGES: readonly string[] = ['orchestrator', 'subagent', 'tool', 'guardrail', 'retry', 'cache'];

export const isStageEvent = (value: unknown): value is StageEvent => {
    const v = value as Partial<StageEvent> | null;
    return typeof v === 'object' && v !== null && v.type === 'stage' && typeof v.stage === 'string' && STAGES.includes(v.stage)
        && (v.state === 'start' || v.state === 'done') && (v.name === undefined || typeof v.name === 'string');
};

/**
 * The lines after one more event. A start opens a line; the matching done closes the first open line of the same
 * stage and name. A done with no open line (a tool reports only when it finishes) adds a closed one.
 */
export function applyStage(lines: readonly StageLine[], event: StageEvent): StageLine[] {
    const match = (line: StageLine) => line.stage === event.stage && line.name === event.name && line.state === 'running';
    const key = `${event.stage}:${event.name ?? ''}:${lines.length}`;
    if (event.state === 'start') return [...lines, { key, stage: event.stage, name: event.name, state: 'running', ok: true }];
    const closed = { state: 'done' as const, ok: event.ok ?? true, passed: event.passed, ms: event.ms };
    const open = lines.findIndex(match);
    if (open === -1) return [...lines, { key, stage: event.stage, name: event.name, ...closed }];
    return lines.map((line, index) => (index === open ? { ...line, ...closed } : line));
}
