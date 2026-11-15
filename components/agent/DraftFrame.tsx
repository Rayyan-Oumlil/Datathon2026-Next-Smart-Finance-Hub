import { Sparkles, EyeOff } from "lucide-react";
import DraftActions from "@/components/agent/DraftActions";
import { cn } from "@/lib/utils";

/**
 * Wraps a part of a page while the agent's proposal for it waits for Save. A part the change would add is outlined and
 * tagged "New"; one it would remove is dimmed, outlined with a dashed line and tagged "Will be hidden". Plain markup
 * with no state, so a server page can use it. The structure is the same with or without a draft, so the content
 * is not mounted again (a chart does not reload) when a proposal arrives or is decided.
 */
// primary: this frame carries the Save and Cancel buttons (one frame per proposal, the first one on the page)
export default function DraftFrame({ state, labels, primary = false, actionId, children }: { state: 'add' | 'remove' | null; labels: { add: string; remove: string; cancel?: string; save?: string }; primary?: boolean; actionId?: string; children: React.ReactNode }) {
    const adding = state === 'add';
    return (
        <div data-draft={state ?? undefined} className={cn('relative scroll-mt-24', state && 'rounded-[18px] outline-2 outline-offset-4', adding && 'outline outline-brand/70', state === 'remove' && 'outline-dashed outline-down/50')}>
            {state && (
                <span className={cn('pointer-events-none absolute -top-3 start-4 z-10 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-bold shadow-sm', adding ? 'bg-brand text-white' : 'bg-down text-white')}>
                    {adding ? <Sparkles className="size-3" aria-hidden /> : <EyeOff className="size-3" aria-hidden />}
                    {adding ? labels.add : labels.remove}
                </span>
            )}
            {state && primary && labels.cancel && labels.save && <DraftActions labels={{ cancel: labels.cancel, save: labels.save }} actionId={actionId} />}
            <div className={cn(state === 'remove' && 'pointer-events-none select-none opacity-45 saturate-50')}>{children}</div>
        </div>
    );
}
