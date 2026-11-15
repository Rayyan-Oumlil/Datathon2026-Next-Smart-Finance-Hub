// The readable timeline of one agent request (brief rule R5): one sentence per action-log row, chosen and filled by
// plain code from the row's own fields. No model writes or rewrites any of it. Pure: rows in, items out; the panel
// turns each item into words with the AgentPanel `timeline.steps.<key>` messages.

export type TimelineRow = {
    id: string;
    at: string;
    step: string;
    actor: string;
    modelId?: string;
    awsRequestId?: string;
    inputTokens?: number;
    outputTokens?: number;
    dataUsed?: unknown;
    statedReason?: string;
    result?: unknown;
};

export type TimelineItem = {
    id: string;                                  // the log row's id
    at: string;                                  // the log row's time (the panel adds it as the `time` value)
    step: string;
    key: string;                                 // message key under `timeline.steps`
    values: Record<string, string | number>;
    failed?: boolean;
    minor?: boolean;                             // left out of the one-line summary, still listed when expanded
};

const obj = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const str = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
const count = (value: unknown): number => (Array.isArray(value) ? value.length : 0);

/** The tool an endpoint names: '/api/internal/tools/market-data' -> 'market-data'. */
export const toolName = (endpoint: unknown): string => {
    const text = str(endpoint) ?? '';
    return text.split('/').filter(Boolean).pop() ?? text;
};

/** The symbols a tool call was about, from its request body ({ symbols: [...] } or { symbol }). */
const symbolsOf = (body: unknown): string => {
    const b = obj(body);
    const list = Array.isArray(b.symbols) ? b.symbols.filter((s): s is string => typeof s === 'string') : [];
    const one = str(b.symbol);
    const all = [...list, ...(one && !list.includes(one) ? [one] : [])];
    return all.slice(0, 6).join(', ') + (all.length > 6 ? '…' : '');
};

function itemFor(row: TimelineRow): Omit<TimelineItem, 'id' | 'at' | 'step'> | null {
    const data = obj(row.dataUsed);
    const result = obj(row.result);
    switch (row.step) {
        case 'chat_input':
            return { key: 'chat_input', values: { turns: typeof data.historyTurns === 'number' ? data.historyTurns : 0 }, minor: true };
        case 'context_built':
            return str(data.risk)
                ? { key: 'context_built', values: { risk: str(data.risk)!, level: str(data.level) ?? 'other', holdings: count(data.holdings), picks: count(data.watchlist) } }
                : { key: 'context_built_noProfile', values: { holdings: count(data.holdings), picks: count(data.watchlist) } };
        case 'prompt_built':
            return { key: 'prompt_built', values: {}, minor: true };
        case 'orchestrator_call':
            return {
                key: 'orchestrator_call',
                values: { model: row.modelId ?? '–', input: row.inputTokens ?? 0, output: row.outputTokens ?? 0 },
                minor: true,
            };
        case 'subagent_call':
            return {
                key: 'subagent_call',
                values: { agent: row.actor.startsWith('subagent:') ? row.actor.slice('subagent:'.length) : row.actor, model: row.modelId ?? '–' },
            };
        case 'tool_call': {
            const tool = toolName(data.endpoint);
            const symbols = symbolsOf(data.body);
            return symbols ? { key: 'tool_call_symbols', values: { tool, symbols } } : { key: 'tool_call', values: { tool } };
        }
        case 'guardrail_check': {
            const attempt = typeof result.attempt === 'number' ? result.attempt : 1;
            return result.passed === true
                ? { key: 'guardrail_passed', values: { attempt } }
                : { key: 'guardrail_failed', values: { attempt }, failed: true };
        }
        case 'action_routed': {
            const outcome = str(result.outcome) ?? 'none';
            const type = str(result.type) ?? '–';
            if (outcome === 'preview') return { key: 'action_preview', values: { type } };
            if (outcome === 'info') return { key: 'action_info', values: { type } };
            if (outcome === 'dropped') return { key: 'action_dropped', values: { type }, failed: true };
            return { key: 'action_none', values: {}, minor: true };
        }
        case 'preview_shown':
            return { key: 'preview_shown', values: { type: str(data.type) ?? '–', conflicts: count(data.conflicts) } };
        case 'confirmed':
            return { key: 'confirmed', values: {} };
        case 'cancelled':
            return { key: 'cancelled', values: {} };
        case 'applied':
            return { key: 'applied', values: {} };
        case 'result': {
            if ('error' in result) return { key: 'result_error', values: {}, failed: true };
            // After a confirmation: the 'applied' row already says it; only a change that did not go through is told
            if ('applied' in result) return result.applied === true ? null : { key: 'result_notApplied', values: {}, failed: true };
            if (obj(result.cache).hit === true) return { key: 'result_cache', values: {} };
            if (result.withheldByWordCheck === true || result.refused === true) return { key: 'result_refused', values: {}, failed: true };
            return { key: 'result_reply', values: { sources: typeof result.sources === 'number' ? result.sources : 0 } };
        }
        case 'undo':
            return result.restored === true ? { key: 'undo', values: {} } : { key: 'undo_failed', values: {}, failed: true };
        case 'error': {
            const tool = data.endpoint ? toolName(data.endpoint) : '';
            return tool ? { key: 'error_tool', values: { tool }, failed: true } : { key: 'error', values: {}, failed: true };
        }
        default:
            return { key: 'unknown', values: { step: row.step }, minor: true };
    }
}

/** The timeline of one request: its rows oldest first, one item per row that says something. */
export function timelineFromRows(rows: readonly TimelineRow[]): TimelineItem[] {
    return [...rows]
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .flatMap((row) => {
            const item = itemFor(row);
            return item ? [{ id: row.id, at: row.at, step: row.step, ...item }] : [];
        });
}

/** Whether the rows already hold the request's last step (its final 'result'), so the timeline is complete. */
export const timelineComplete = (rows: readonly TimelineRow[]): boolean => rows.some((row) => row.step === 'result');
