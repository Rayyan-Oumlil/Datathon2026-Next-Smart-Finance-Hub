'use client';

import { ArrowRight, Check, Sparkles, Undo2, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import PreviewDetails, { type PreviewData } from "@/components/agent/PreviewDetails";
import { cn } from "@/lib/utils";

/** What the proposal changes: sets the label. */
export type DockKind = 'layout_overview' | 'layout_portfolio' | 'strategy_propose' | 'profile_change' | 'rule_create' | 'rule_pause';

type Props = {
    kind: DockKind;
    page: string;
    preview: PreviewData;
    change: 'pending' | 'applied' | 'cancelled' | 'undone' | undefined;
    outcome?: string;
    strategyId?: string;
    withConflict: boolean;
    onPage: boolean;
    busy: boolean;
    onSave: () => void;
    onCancel: () => void;
    onUndo: () => void;
    onDismiss: () => void;
};

/**
 * The agent's proposal as a card at the top of the page it belongs to, for the changes that have nothing to preview in
 * place (a strategy and its replay, profile answers, a rule): the details and the Cancel and Save buttons sit together,
 * in one place, like a suggestion to accept. (A layout change is previewed on the module itself, which carries the
 * buttons.) On any other page it is one line that links to its page. After the choice it says what happened and offers Undo.
 */
export default function ProposalDock({ kind, page, preview, change, outcome, strategyId, withConflict, onPage, busy, onSave, onCancel, onUndo, onDismiss }: Props) {
    const t = useTranslations('AgentPanel');
    const pageName = t(`pageName.${page.slice(1)}`);
    const decided = change === 'applied' || change === 'cancelled' || change === 'undone';
    const status = change === 'applied' ? t('preview.saved') : change === 'undone' ? t('preview.undone') : t('preview.cancelled');

    return (
        <section role="region" aria-label={t('dock.region')} className="card overflow-hidden border-brand/50 animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="flex items-center gap-3 px-4 py-3">
                <span aria-hidden className={cn('grid size-9 flex-none place-items-center rounded-full text-white', change === 'applied' ? 'bg-up' : decided ? 'bg-faint' : 'bg-brand')}>
                    {change === 'applied' ? <Check className="size-[18px]" /> : decided ? <X className="size-[18px]" /> : <Sparkles className="size-[18px]" />}
                </span>
                <div className="min-w-0 flex-1" aria-live="polite">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-brand-ink">{t('dock.by')} · {t(`dock.kind.${kind}`)}</p>
                    <p className="text-[15px] font-semibold leading-snug text-foreground">
                        {decided ? `${status}${outcome ? ` · ${outcome}` : ''}` : onPage ? preview.summary : t('preview.waiting', { page: pageName })}
                    </p>
                </div>
                {!onPage && !decided && <Link href={page} className="btn btn-primary h-9 flex-none">{t('preview.openPage', { page: pageName })} <ArrowRight aria-hidden /></Link>}
                {decided && <button type="button" className="icon-btn flex-none" onClick={onDismiss} aria-label={t('preview.dismiss')} title={t('preview.dismiss')}><X aria-hidden /></button>}
            </div>

            {onPage && !decided && (
                <>
                    <div className="border-t border-line bg-canvas px-4 py-3 text-[13px]"><PreviewDetails preview={preview} /></div>
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3">
                        <p className="text-[12.5px] text-faint">{t('dock.hint')}</p>
                        <div className="flex gap-2">
                            <button type="button" className="btn btn-ghost h-9" disabled={busy} onClick={onCancel}>{t('preview.cancel')}</button>
                            <button type="button" className="btn btn-primary h-9" disabled={busy} onClick={onSave}><Check aria-hidden /> {withConflict ? t('preview.saveSimulation') : t('preview.save')}</button>
                        </div>
                    </div>
                </>
            )}

            {decided && (change === 'applied') && (
                <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5">
                    {strategyId && <Link href={`/time-machine?strategy=${encodeURIComponent(strategyId)}`} className="btn btn-ghost h-9">{t('preview.strategy.openTimeMachine')}</Link>}
                    <button type="button" className="btn btn-ghost h-9" disabled={busy} onClick={onUndo}><Undo2 aria-hidden /> {t('preview.undo')}</button>
                </div>
            )}
        </section>
    );
}
