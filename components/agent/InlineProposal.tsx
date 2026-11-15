'use client';

import { Check, Sparkles } from "lucide-react";
import { useProposalDecision } from "@/hooks/usePendingProposal";

/** One line inside a part of a page (a card, a setting) that says what the agent proposes there, with Cancel and Save beside it. */
export default function InlineProposal({ text, labels, actionId }: { text: string; labels: { cancel: string; save: string }; actionId?: string }) {
    const { busy, decide } = useProposalDecision(actionId);
    return (
        <div role="group" aria-label={text} className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-brand/40 bg-brand-soft px-3 py-2 text-[13px] animate-in fade-in duration-200">
            <span className="inline-flex items-center gap-1.5 font-semibold text-brand-ink"><Sparkles className="size-3.5" aria-hidden /> {text}</span>
            <span className="inline-flex gap-1.5">
                <button type="button" className="btn btn-ghost h-8 px-3 text-[13px]" disabled={busy} onClick={() => decide(false)}>{labels.cancel}</button>
                <button type="button" className="btn btn-primary h-8 px-3.5 text-[13px]" disabled={busy} onClick={() => decide(true)}><Check aria-hidden /> {labels.save}</button>
            </span>
        </div>
    );
}
