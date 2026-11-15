// Links a step the panel showed ("Portfolio specialist", "Checking figures and wording") to the rows of the agent
// action log that record it, so a click goes from what the agent did to the audit trail. Pure and tested alone.
//
// A stage has no id in common with a row. They are tied by what both hold in order: the log rows come oldest first,
// and the stages come in the order the work ran.

import type { StageLine } from './stages';

export type AuditRow = { id: string; step: string; actor: string; dataUsed?: unknown };

const endpointOf = (row: AuditRow): string | undefined => {
    const data = row.dataUsed as { endpoint?: unknown } | undefined;
    return typeof data?.endpoint === 'string' ? data.endpoint : undefined;
};

/** The rows that record stage `index` of `lines`. Several model calls make up one stage, so it can be more than one. */
export function rowsForStage(lines: readonly StageLine[], index: number, rows: readonly AuditRow[]): AuditRow[] {
    const line = lines[index];
    if (!line) return [];
    const ordinal = lines.slice(0, index).filter((other) => other.stage === line.stage && other.name === line.name).length;
    const checks = rows.flatMap((row, at) => (row.step === 'guardrail_check' ? [at] : []));
    const between = (from: number, to: number) => rows.filter((row, at) => row.step === 'orchestrator_call' && at > from && at < to);

    switch (line.stage) {
        case 'orchestrator': return between(-1, checks[0] ?? Infinity);
        // A retry follows a failed check: its calls sit between that check and the next one
        case 'retry': return checks[ordinal] === undefined ? [] : between(checks[ordinal], checks[ordinal + 1] ?? Infinity);
        case 'subagent': return rows.filter((row) => row.step === 'subagent_call' && row.actor === `subagent:${line.name}`);
        case 'tool': return rows.filter((row) => (row.step === 'tool_call' || row.step === 'error') && endpointOf(row)?.endsWith(`/${line.name}`)).slice(ordinal, ordinal + 1);
        case 'guardrail': return rows.filter((row) => row.step === 'guardrail_check').slice(ordinal, ordinal + 1);
        case 'cache': return rows.filter((row) => row.step === 'result');
        default: return [];
    }
}
