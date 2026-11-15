'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { Level, ProfileConfig, Risk } from '@/lib/domain/types';
import Panel from '@/components/Panel';
import Chips from '@/components/onboarding/Chips';
import { LevelBreakdown, RiskBreakdown, type RuleBands } from './RuleBreakdown';

const LEVELS: Level[] = ['Novice', 'Intermediate', 'Expert'];
const RISKS: Risk[] = ['Low', 'Medium', 'High'];

type Edit = { field: 'level' | 'risk'; before: string; after: string; at: string };

type ModuleProps = {
    id: 'level' | 'risk';
    title: string;
    note: string;
    values: string[];
    chosen: string;
    computed: string;
    overridden: boolean;
    busy: boolean;
    edit: Edit | null;
    onChoose: (value: string | null) => void;
    children: React.ReactNode;
};

function Module({ id, title, note, values, chosen, computed, overridden, busy, edit, onChoose, children }: ModuleProps) {
    return (
        <Panel title={title} sub={note} bodyClassName="flex flex-col gap-4 p-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <p id={`${id}-label`} className="form-label">{overridden ? 'Chosen by you' : 'Computed from your answers'}</p>
                    <p className="text-[26px] font-bold tracking-[-0.03em] text-foreground">{chosen}</p>
                </div>
                {overridden && (
                    <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => onChoose(null)}>
                        Return to computed ({computed})
                    </button>
                )}
            </div>

            <Chips
                labelledBy={`${id}-label`}
                options={values.map((value) => ({ value, label: value, hint: value === computed ? 'computed' : undefined }))}
                selected={[chosen]}
                disabled={busy}
                onToggle={(value) => value !== chosen && onChoose(value)}
            />

            {overridden && (
                <p className="rounded-[10px] bg-brand-soft px-3 py-2 text-[13px] text-brand-ink">
                    Computed: <strong>{computed}</strong>. Chosen: <strong>{chosen}</strong>. The app uses the chosen value; the computed one is kept beside it.
                </p>
            )}
            {edit && (
                <p role="status" className="rounded-[10px] bg-hover px-3 py-2 text-[13px] text-foreground">
                    Last change here: before <strong>{edit.before}</strong>, after <strong>{edit.after}</strong>. Saved and logged at {edit.at}.
                </p>
            )}

            <details className="group">
                <summary className="cursor-pointer text-[13px] font-semibold text-brand-ink outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                    How {computed} was computed
                </summary>
                <div className="mt-2">{children}</div>
            </details>
        </Panel>
    );
}

// The Level and Risk modules. A choice is sent to PATCH /api/profile, which stores it as an override and logs it.
export default function ProfileModules({ profile: initial, bands }: { profile: ProfileConfig; bands: RuleBands }) {
    const router = useRouter();
    const [profile, setProfile] = useState(initial);
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
            const edit: Edit = { field, before: body.before[field], after: body.after[field], at: new Date().toLocaleTimeString() };
            setEdits((e) => ({ ...e, [field]: edit }));
            toast.success(`${field === 'level' ? 'Level' : 'Risk profile'}: ${edit.before} → ${edit.after}`);
            // The shell and the other tabs read the profile on the server
            router.refresh();
        } catch {
            toast.error('The change could not be saved. Nothing was changed.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="grid gap-4 lg:grid-cols-2">
            <Module
                id="level"
                title="Level"
                note="Changes the interface."
                values={LEVELS}
                chosen={profile.level}
                computed={profile.levelResult.level}
                overridden={profile.levelOverridden}
                busy={busy}
                edit={edits.level}
                onChoose={(value) => change('level', value)}
            >
                <LevelBreakdown profile={profile} bands={bands} />
            </Module>
            <Module
                id="risk"
                title="Risk"
                note="Changes the watchlist only."
                values={RISKS}
                chosen={profile.risk}
                computed={profile.riskResult.risk}
                overridden={profile.riskOverridden}
                busy={busy}
                edit={edits.risk}
                onChoose={(value) => change('risk', value)}
            >
                <RiskBreakdown profile={profile} bands={bands} />
            </Module>
        </div>
    );
}
