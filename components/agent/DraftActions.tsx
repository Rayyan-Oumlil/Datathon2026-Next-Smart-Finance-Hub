'use client';

import { Check } from "lucide-react";
import { useProposalDecision } from "@/hooks/usePendingProposal";

/**
 * Save and Cancel, attached to the part of the page that shows the agent's proposal (the corner of the previewed
 * module), so the decision is taken right next to the change. It only announces the choice: the agent panel holds the
 * proposal and carries it out, then the page refreshes and the preview goes away.
 */
export default function DraftActions({ labels, actionId }: { labels: { cancel: string; save: string }; actionId?: string }) {
    const { busy, decide } = useProposalDecision(actionId);
    return (
        // Zero height and sticky: at rest the buttons sit on the top edge of the module, and while the visitor scrolls
        // through a tall module they stay in view at its top right, next to the change
        <div className="sticky top-5 z-20 h-0">
            <span className="absolute -top-4 end-3 inline-flex items-center gap-1 rounded-full bg-card p-1 shadow-[0_6px_20px_oklch(0_0_0/0.18)] ring-1 ring-line animate-in fade-in zoom-in-95 duration-200">
                <button type="button" className="btn btn-ghost h-8 rounded-full px-3 text-[13px]" disabled={busy} onClick={() => decide(false)}>{labels.cancel}</button>
                <button type="button" className="btn btn-primary h-8 rounded-full px-3.5 text-[13px]" disabled={busy} onClick={() => decide(true)}><Check aria-hidden /> {labels.save}</button>
            </span>
        </div>
    );
}
