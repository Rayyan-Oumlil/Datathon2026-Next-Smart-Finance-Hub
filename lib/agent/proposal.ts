// The change the agent proposed that still waits for Save, read by the page it belongs on so the page can show it as a
// preview (a module that would appear, one that would go). The proposal itself lives in the visitor's app state
// (router.ts); nothing here changes anything.

import { currentScope, type Scope } from '@/lib/session';
import { readState } from '@/lib/store';
import type { ProposalPage, StoredAction } from './router';

export type PendingProposal = {
    actionId: string;
    type: string;
    summary: string;
    page: ProposalPage;
    /** For a layout change: the full list of widget ids the layout would have, and the list it has now. */
    layout?: string[];
    current?: string[];
    /** For a profile change: the level and risk the profile would have. */
    profile?: { level?: string; risk?: string };
};

/** The newest change still waiting for Save on this page, or null. */
export async function pendingProposal(page: ProposalPage, scope?: Scope): Promise<PendingProposal | null> {
    const s = scope ?? await currentScope();
    const { pendingPreviews } = await readState(s);
    const found = [...pendingPreviews].reverse().map((p) => p as StoredAction).find((p) => p.status === 'pending' && p.preview?.page === page);
    if (!found) return null;
    const type = found.proposed.type as string;
    const isLayout = type === 'layout_change';
    return {
        actionId: found.actionId, type, summary: found.preview.summary, page,
        ...(isLayout ? { layout: found.proposed.params.layout as string[], current: found.preview.before as string[] } : {}),
        ...(type === 'profile_change' ? { profile: { level: (found.preview.after as { level?: string })?.level, risk: (found.preview.after as { risk?: string })?.risk } } : {}),
    };
}

export const PROPOSAL_PAGES: readonly ProposalPage[] = ['/strategy', '/overview', '/portfolio', '/profile'];
