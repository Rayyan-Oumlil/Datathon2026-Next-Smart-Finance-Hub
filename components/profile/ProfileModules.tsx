'use client';

import InlineProposal from '@/components/agent/InlineProposal';
import { usePendingProposal } from '@/hooks/usePendingProposal';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { Level, ProfileConfig, Risk } from '@/lib/domain/types';
import Panel from '@/components/Panel';
import Chips from '@/components/onboarding/Chips';
import { formatDateTime } from '@/i18n/format';
import { LevelBreakdown, RiskBreakdown, type RuleBands } from './RuleBreakdown';

const LEVELS: Level[] = ['Novice', 'Intermediate', 'Expert'];
const RISKS: Risk[] = ['Low', 'Medium', 'High'];

type Edit = { field: 'level' | 'risk'; before: string; after: string; at: string };

type ModuleProps = {
    id: 'level' | 'risk';
    values: string[];
    chosen: string;
    computed: string;
    overridden: boolean;
    busy: boolean;
    edit: Edit | null;
    onChoose: (value: string | null) => void;
    proposal?: { value: string; actionId?: string };
    children: React.ReactNode;
};

function Module({ id, values, chosen, computed, overridden, busy, edit, onChoose, proposal, children }: ModuleProps) {
    const t = useTranslations('Profile');
    // The stored values are the English enum names; the screen shows them in the active language
    const word = (value: string) => t(id, { [id]: value });
    const strong = { strong: (chunks: React.ReactNode) => <strong>{chunks}</strong> };
    return (
        <Panel title={t(`modules.${id}.title`)} sub={t(`modules.${id}.note`)} bodyClassName="flex flex-col gap-4 p-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <p id={`${id}-label`} className="form-label">{overridden ? t('modules.chosenByYou') : t('modules.computedFromAnswers')}</p>
                    <p className="text-[26px] font-bold tracking-[-0.03em] text-foreground">{word(chosen)}</p>
                </div>
                {overridden && (
                    <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => onChoose(null)}>
                        {t('modules.returnToComputed', { computed: word(computed) })}
                    </button>
                )}
            </div>

            <Chips
                labelledBy={`${id}-label`}
                options={values.map((value) => ({ value, label: word(value), hint: proposal?.value === value ? t('modules.proposedHint') : value === computed ? t('modules.computedHint') : undefined }))}
                selected={[chosen]}
                disabled={busy}
                onToggle={(value) => value !== chosen && onChoose(value)}
            />

            {proposal && <InlineProposal text={t('modules.proposed', { value: word(proposal.value) })} actionId={proposal.actionId} labels={{ cancel: t('modules.proposalCancel'), save: t('modules.proposalSave') }} />}

            {overridden && (
                <p className="rounded-[10px] bg-brand-soft px-3 py-2 text-[13px] text-brand-ink">
                    {t.rich('modules.override', { computed: word(computed), chosen: word(chosen), ...strong })}
                </p>
            )}
            {edit && (
                <p role="status" className="rounded-[10px] bg-hover px-3 py-2 text-[13px] text-foreground">
                    {t.rich('modules.lastChange', { before: word(edit.before), after: word(edit.after), at: edit.at, ...strong })}
                </p>
            )}

            <details className="group">
                <summary className="cursor-pointer text-[13px] font-semibold text-brand-ink outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                    {t('modules.howComputed', { computed: word(computed) })}
                </summary>
                <div className="mt-2">{children}</div>
            </details>
        </Panel>
    );
}

// The Level and Risk modules. A choice is sent to PATCH /api/profile, which stores it as an override and logs it.
export default function ProfileModules({ profile: initial, bands }: { profile: ProfileConfig; bands: RuleBands }) {
    const router = useRouter();
    const t = useTranslations('Profile');
    const locale = useLocale();
    const [profile, setProfile] = useState(initial);
    // The server sends the profile again after a refresh (a change saved or undone by the agent): show it, in place
    const [received, setReceived] = useState(initial);
    if (received !== initial) {
        setReceived(initial);
        setProfile(initial);
    }
    // A level or risk the agent proposed, still waiting for Save: marked on its card, with the buttons beside it
    const pending = usePendingProposal('/profile');
    const proposedLevel = pending?.profile?.level && pending.profile.level !== profile.level ? pending.profile.level : null;
    const proposedRisk = pending?.profile?.risk && pending.profile.risk !== profile.risk ? pending.profile.risk : null;
    const [busy, setBusy] = useState(false);
    const [edits, setEdits] = useState<{ level: Edit | null; risk: Edit | null }>({ level: null, risk: null });

    const change = async (field: 'level' | 'risk', value: string | null) => {
        setBusy(true);
        try {
            const res = await fetch('/api/profile', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ [field]: value }),
            });
            const body = await res.json().catch(() => null);
            if (!res.ok || !body?.profile) throw new Error(String(res.status));
            setProfile(body.profile);
            const edit: Edit = { field, before: body.before[field], after: body.after[field], at: formatDateTime(new Date().toISOString(), locale, { timeStyle: 'medium' }) };
            setEdits((e) => ({ ...e, [field]: edit }));
            const shown = (value: string) => t(field, { [field]: value });
            toast.success(t(field === 'level' ? 'modules.toastLevel' : 'modules.toastRisk', { before: shown(edit.before), after: shown(edit.after) }));
            // The shell and the other tabs read the profile on the server
            router.refresh();
        } catch {
            toast.error(t('modules.changeFailed'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="grid gap-4 lg:grid-cols-2">
            <Module
                id="level"
                values={LEVELS}
                chosen={profile.level}
                computed={profile.levelResult.level}
                overridden={profile.levelOverridden}
                busy={busy}
                edit={edits.level}
                onChoose={(value) => change('level', value)}
                proposal={proposedLevel ? { value: proposedLevel, actionId: pending?.actionId } : undefined}
            >
                <LevelBreakdown profile={profile} bands={bands} />
            </Module>
            <Module
                id="risk"
                values={RISKS}
                chosen={profile.risk}
                computed={profile.riskResult.risk}
                overridden={profile.riskOverridden}
                busy={busy}
                edit={edits.risk}
                onChoose={(value) => change('risk', value)}
                proposal={proposedRisk ? { value: proposedRisk, actionId: pending?.actionId } : undefined}
            >
                <RiskBreakdown profile={profile} bands={bands} />
            </Module>
        </div>
    );
}
