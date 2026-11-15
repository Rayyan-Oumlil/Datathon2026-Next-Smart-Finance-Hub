'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PendingProposal } from '@/lib/agent/proposal';
import type { ProposalPage } from '@/lib/agent/router';

/** Fired by the agent panel when a proposal arrives, is saved, cancelled or undone. */
export const PROPOSAL_CHANGED_EVENT = 'agent:proposal-changed';
/** Fired by the Save and Cancel buttons on the previewed part of a page; the agent panel carries the decision out. detail: { accept: boolean; actionId?: string } */
export const PROPOSAL_DECIDE_EVENT = 'agent:proposal-decide';

/** Save and Cancel for the proposal with this id, from any part of a page: announces the choice; the agent panel carries it out. */
export function useProposalDecision(actionId?: string) {
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        const done = () => setBusy(false);
        window.addEventListener(PROPOSAL_CHANGED_EVENT, done);
        window.addEventListener('agent:data-changed', done);
        return () => {
            window.removeEventListener(PROPOSAL_CHANGED_EVENT, done);
            window.removeEventListener('agent:data-changed', done);
        };
    }, []);
    const decide = (accept: boolean) => {
        setBusy(true);
        window.dispatchEvent(new CustomEvent(PROPOSAL_DECIDE_EVENT, { detail: { accept, actionId } }));
    };
    return { busy, decide };
}

/**
 * The change the agent proposed for this page that still waits for Save, so a client page can show it as a preview.
 * Read again whenever the agent panel says a proposal arrived or was decided, or that data changed.
 */
export function usePendingProposal(page: ProposalPage): PendingProposal | null {
    const [proposal, setProposal] = useState<PendingProposal | null>(null);
    const load = useCallback(async () => {
        try {
            const response = await fetch(`/api/agent/proposal?page=${encodeURIComponent(page)}`, { cache: 'no-store' });
            const body = await response.json().catch(() => null);
            setProposal(response.ok ? body?.proposal ?? null : null);
        } catch {
            setProposal(null);
        }
    }, [page]);
    useEffect(() => {
        void load();
        window.addEventListener(PROPOSAL_CHANGED_EVENT, load);
        window.addEventListener('agent:data-changed', load);
        return () => {
            window.removeEventListener(PROPOSAL_CHANGED_EVENT, load);
            window.removeEventListener('agent:data-changed', load);
        };
    }, [load]);
    return proposal;
}
