// The backend itself is not re-exported: the functions below are the only way to write, and for the two
// logs they can only append.
export { AlreadyExistsError, tables } from './client';
export { getProfile, putProfile } from './profile';
export { appendDecision, getDecision, listDecisions } from './decision-log';
export type { DecisionQuery, NewDecision } from './decision-log';
export { appendAgentAction, listAgentActions } from './agent-action-log';
export type { AgentActionQuery, NewAgentAction } from './agent-action-log';
export { readState, updateState } from './app-state';
export type { AppState, LayoutWidget, PendingPreview, SavedLayout, WatchlistState } from './app-state';
