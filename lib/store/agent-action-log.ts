import type { AgentActionLogEntry } from '@/lib/domain/types';
import { getBackend, plain, tables } from './client';
import { isoTime, newId, nextTimestamp } from './ids';

export type NewAgentAction = Omit<AgentActionLogEntry, 'id' | 'at'> & Partial<Pick<AgentActionLogEntry, 'at'>>;

export type AgentActionQuery = {
    actionId?: string;          // only the rows of one agent request
    limit?: number;
    newestFirst?: boolean;      // default false: oldest first, the order the steps happened
};

/** Appends one row to the agent action log. Rows are never changed or removed afterwards. */
export async function appendAgentAction(entry: NewAgentAction): Promise<AgentActionLogEntry> {
    const at = entry.at === undefined ? nextTimestamp() : isoTime(entry.at);
    const full: AgentActionLogEntry = plain({ ...entry, at, id: newId(at) });
    await getBackend().putNew(tables.agentActionLog(), full);
    return full;
}

export async function listAgentActions(userId: string, query: AgentActionQuery = {}): Promise<AgentActionLogEntry[]> {
    const table = tables.agentActionLog();
    const rows = query.actionId
        ? await getBackend().query({ table, index: 'byAction', keyName: 'actionId', keyValue: query.actionId, filter: { userId } })
        : await getBackend().query({ table, keyName: 'userId', keyValue: userId });
    const entries = rows as AgentActionLogEntry[];
    if (query.newestFirst) entries.reverse();
    return query.limit === undefined ? entries : entries.slice(0, query.limit);
}
