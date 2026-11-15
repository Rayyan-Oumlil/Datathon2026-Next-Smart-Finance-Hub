// The web side of the agent action log (docs/agent-api.md section 3). Plain code writes each row; rows are
// only ever appended, and they share the request's actionId with the rows the agent service writes.

import type { AgentActionLogEntry, AgentStep } from '@/lib/domain/types';
import type { Scope } from '@/lib/session';
import { appendAgentAction } from '@/lib/store';

export type WebStep = Extract<AgentStep, 'chat_input' | 'context_built' | 'action_routed' | 'preview_shown' | 'confirmed' | 'cancelled' | 'applied' | 'result' | 'undo'>;
export type StepFields = Partial<Pick<AgentActionLogEntry, 'promptVersion' | 'replySha256' | 'dataUsed' | 'statedReason' | 'before' | 'after' | 'result'>>;

/**
 * Appends one row under the scope id (the same userId the agent service receives and logs its own rows under).
 * It throws when the row cannot be written: a step that leaves no trace does not go ahead.
 */
export function logStep(scope: Pick<Scope, 'scopeId'>, actionId: string, step: WebStep, fields: StepFields = {}): Promise<AgentActionLogEntry> {
    return appendAgentAction({ userId: scope.scopeId, actionId, step, actor: 'web', ...fields });
}
