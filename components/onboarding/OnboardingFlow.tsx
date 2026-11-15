'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';
import type { Level, OnboardingAnswers, ProfileConfig, Risk } from '@/lib/domain/types';
import { cn } from '@/lib/utils';
import { LevelBreakdown, RiskBreakdown, type RuleBands } from '@/components/profile/RuleBreakdown';
import Chips from './Chips';
import TickerPicker from './TickerPicker';
import {
    AGENT_STYLE, DROP20, ECHEANCE, EXPERIENCE, GOAL, INVESTING_GOAL, MARKETS, SELF_RATING, TOOLS, TRADED,
    themeLabel, type Option,
} from './labels';

export type UniverseOptions = { sectors: Array<{ name: string; count: number }>; niches: Record<string, string[]>; themes: string[] };

type Draft = Partial<OnboardingAnswers> & { tools: string[]; sectors: string[]; niches: string[]; themes: string[]; brands: string[]; avoid: string[] };
type StepId =
    | 'goal' | 'traded' | 'experience' | 'tools' | 'investingGoal' | 'echeance' | 'drop20' | 'selfRating'
    | 'markets' | 'sectors' | 'niches' | 'themes' | 'brands' | 'avoid' | 'agentStyle';

const PARTS = ['About you', 'Your comfort with risk', 'What interests you'];

const STEPS: Record<StepId, { part: number; title: string; helper: string; options?: Option[]; multi?: boolean; skippable?: boolean }> = {
    goal: { part: 0, title: 'What brings you here?', helper: 'This only sets the context. It does not change your level or your risk profile.', options: GOAL },
    traded: { part: 0, title: 'Have you placed a trade yourself?', helper: 'On any platform, with your own money. If not, the next two questions are left out.', options: TRADED },
    experience: { part: 0, title: 'How long have you traded?', helper: 'Counted from your first trade, even with breaks.', options: EXPERIENCE },
    tools: { part: 0, title: 'Which tools do you use?', helper: 'Pick all that apply, or continue with none.', options: TOOLS, multi: true },
    investingGoal: { part: 1, title: 'What is your investing goal?', helper: 'Income means regular payouts, growth means a rising value over time, trading means frequent moves.', options: INVESTING_GOAL },
    echeance: { part: 1, title: 'When do you want to see profit progress?', helper: 'A longer horizon leaves more time to recover from a drop.', options: ECHEANCE },
    drop20: { part: 1, title: 'If a position dropped 20%, you would…', helper: 'There is no right answer. Pick what you would really do.', options: DROP20 },
    selfRating: { part: 1, title: 'How would you rate your own comfort with risk?', helper: 'Your own rating is one of four answers. If the result differs from it, you will see both.', options: SELF_RATING },
    markets: { part: 2, title: 'Which markets interest you?', helper: 'The watchlist only lists assets from the markets picked here.', options: MARKETS },
    sectors: { part: 2, title: 'Which sectors do you like?', helper: 'Pick any number. Skipping means no preference.', multi: true, skippable: true },
    niches: { part: 2, title: 'Any niches inside those sectors?', helper: 'Only niches of the sectors you picked are shown. Skipping means no preference.', multi: true, skippable: true },
    themes: { part: 2, title: 'Any themes you follow?', helper: 'Theme tags are set by hand in this demo. The ESG tag is demo data.', multi: true, skippable: true },
    brands: { part: 2, title: 'Brands you know', helper: 'Companies you use or admire. They are looked at first when the watchlist is built.', skippable: true },
    avoid: { part: 2, title: 'Anything to leave out?', helper: 'Sectors or companies on this list never appear in your watchlist.', skippable: true },
    agentStyle: { part: 2, title: 'How do you want the agent to talk to you?', helper: 'This sets the tone of the answers. You can change it later.', options: AGENT_STYLE },
};

function stepsFor(draft: Draft, options: UniverseOptions): StepId[] {
    const hasNiches = draft.sectors.some((sector) => options.niches[sector]?.length);
    return [
        'goal', 'traded',
        ...(draft.traded ? (['experience', 'tools'] as StepId[]) : []),
        'investingGoal', 'echeance', 'drop20', 'selfRating',
        'markets', 'sectors',
        ...(hasNiches ? (['niches'] as StepId[]) : []),
        'themes', 'brands', 'avoid', 'agentStyle',
    ];
}

// A list question is answered even when empty: that means "none" or "no preference"
const answered = (draft: Draft, id: StepId): boolean => draft[id] !== undefined;

const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

type Props = {
    options: UniverseOptions;
    bands: RuleBands;
    initial?: OnboardingAnswers;   // set when re-opening onboarding from the Profile tab
};

export default function OnboardingFlow({ options, bands, initial }: Props) {
    const editing = Boolean(initial);
    // Once a profile exists, answers are saved as an edit of it
    const [saved, setSaved] = useState(editing);
    const [draft, setDraft] = useState<Draft>(() => ({
        ...initial,
        tools: initial?.tools ?? [],
        sectors: initial?.sectors ?? [],
        niches: initial?.niches ?? [],
        themes: initial?.themes ?? [],
        brands: initial?.brands ?? [],
        avoid: initial?.avoid ?? [],
    }));
    const [stepId, setStepId] = useState<StepId>('goal');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<{ profile: ProfileConfig; before?: { level: Level; risk: Risk } } | null>(null);
    const headingRef = useRef<HTMLHeadingElement>(null);
    // A second tap on the last answer must not save, and log, the same answers twice
    const submitting = useRef(false);

    const ids = stepsFor(draft, options);
    const index = ids.indexOf(stepId);
    const step = STEPS[stepId];
    const canContinue = answered(draft, stepId);

    // Move focus to the new question so keyboard and screen-reader users land on it
    useEffect(() => {
        headingRef.current?.focus();
    }, [stepId, result]);

    const submit = useCallback(async (d: Draft) => {
        if (submitting.current) return;
        submitting.current = true;
        setSaving(true);
        setError(null);
        // Niches of a sector that is no longer picked are dropped; someone who has not traded was not asked about experience or tools
        const allowed = new Set(d.sectors.flatMap((sector) => options.niches[sector] ?? []));
        const { experience, tools, ...rest } = d;
        const answers = {
            ...rest,
            niches: d.niches.filter((niche) => allowed.has(niche)),
            ...(d.traded ? { experience, tools } : {}),
        };
        try {
            // A first run saves the whole set; an edit changes the answers and keeps any level or risk chosen on the Profile tab
            const res = await fetch('/api/profile', {
                method: saved ? 'PATCH' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ answers }),
            });
            const body = await res.json().catch(() => null);
            if (!res.ok || !body?.profile) throw new Error(String(res.status));
            setResult({ profile: body.profile, before: body.before });
            setSaved(true);
        } catch {
            setError('Your answers could not be saved. Nothing was changed. Please try again.');
        } finally {
            submitting.current = false;
            setSaving(false);
        }
    }, [saved, options.niches]);

    const next = useCallback((d: Draft) => {
        const order = stepsFor(d, options);
        const at = order.indexOf(stepId);
        if (at === order.length - 1) void submit(d);
        else setStepId(order[at + 1]);
    }, [options, stepId, submit]);

    const back = () => {
        setError(null);
        if (index > 0) setStepId(ids[index - 1]);
    };

    // Enter continues even when no control has focus
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Enter' || result || saving || !canContinue) return;
            const target = e.target as HTMLElement;
            if (target === document.body || target === headingRef.current) next(draft);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [canContinue, draft, next, result, saving]);

    // One tap answers a single-choice question and moves on
    const pick = (value: string) => {
        const updated: Draft = { ...draft, [stepId]: stepId === 'traded' ? value === 'yes' : value };
        setDraft(updated);
        setTimeout(() => next(updated), 160);
    };
    const setList = (key: 'tools' | 'sectors' | 'niches' | 'themes' | 'brands' | 'avoid', values: string[]) =>
        setDraft((d) => ({ ...d, [key]: values }));

    if (result) {
        const { profile, before } = result;
        const changed = before && (before.level !== profile.level || before.risk !== profile.risk);
        return (
            <div className="flex flex-col gap-5 p-5 sm:p-7">
                <div>
                    <p className="kicker">Your result</p>
                    <h1 ref={headingRef} tabIndex={-1} className="mt-1 text-[24px] font-bold leading-tight tracking-[-0.03em] text-foreground outline-none">
                        Your level: {profile.level}. Your risk profile: {profile.risk}.
                    </h1>
                    <p className="mt-1.5 text-[13.5px] text-muted-foreground">
                        Computed on the server from your answers by rules <span className="mono">{profile.ruleVersions.level}</span> and{' '}
                        <span className="mono">{profile.ruleVersions.risk}</span>, then saved with the answers and logged. The level changes the interface.
                        The risk profile changes the watchlist only. Both can be changed on the Profile tab.
                    </p>
                </div>

                {before && (
                    <p className="rounded-[10px] bg-hover px-3 py-2 text-[13px] text-foreground">
                        Before: {before.level}, {before.risk} risk. After: {profile.level}, {profile.risk} risk.{' '}
                        {changed ? '' : 'No change.'}
                    </p>
                )}

                <section aria-labelledby="result-level" className="flex flex-col gap-2">
                    <h2 id="result-level" className="form-label">Why {profile.levelResult.level}</h2>
                    <LevelBreakdown profile={profile} bands={bands} />
                    {profile.levelOverridden && (
                        <p className="text-[13px] text-muted-foreground">You chose {profile.level} on the Profile tab; that choice is kept.</p>
                    )}
                </section>

                <section aria-labelledby="result-risk" className="flex flex-col gap-2">
                    <h2 id="result-risk" className="form-label">Why {profile.riskResult.risk} risk</h2>
                    <RiskBreakdown profile={profile} bands={bands} />
                    {profile.riskOverridden && (
                        <p className="text-[13px] text-muted-foreground">You chose {profile.risk} on the Profile tab; that choice is kept.</p>
                    )}
                </section>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                    <button
                        type="button"
                        className="text-[13.5px] font-semibold text-brand-ink underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                        onClick={() => {
                            setResult(null);
                            setStepId('goal');
                        }}
                    >
                        Edit my answers
                    </button>
                    <Link href="/portfolio" className="btn btn-primary">
                        Open my dashboard <ArrowRight aria-hidden />
                    </Link>
                </div>
            </div>
        );
    }

    const titleId = `q-${stepId}`;
    const listOptions = (values: string[], label: (v: string) => string = (v) => v): Option[] => values.map((value) => ({ value, label: label(value) }));

    return (
        <form
            className="flex flex-col gap-6 p-5 sm:p-7"
            onSubmit={(e) => {
                e.preventDefault();
                if (canContinue && !saving) next(draft);
            }}
        >
            <ol className="grid grid-cols-3 gap-2" aria-label="Progress">
                {PARTS.map((name, part) => {
                    const inPart = ids.filter((id) => STEPS[id].part === part);
                    const done = inPart.filter((id) => ids.indexOf(id) < index).length;
                    const current = step.part === part;
                    return (
                        <li key={name} aria-current={current ? 'step' : undefined} className="flex min-w-0 flex-col gap-1.5">
                            <span className="h-1.5 overflow-hidden rounded-full bg-hover">
                                <span className="block h-full rounded-full bg-brand transition-[width] duration-300" style={{ width: `${(done / inPart.length) * 100}%` }} />
                            </span>
                            <span className={cn('text-[11.5px] font-bold leading-tight', current ? 'text-foreground' : 'text-faint')}>{name}</span>
                        </li>
                    );
                })}
            </ol>

            <div className="flex min-h-[250px] flex-col gap-4">
                <div>
                    <p className="kicker">{PARTS[step.part]} · question {index + 1}{step.skippable ? ' · optional' : ''}</p>
                    <h1 id={titleId} ref={headingRef} tabIndex={-1} className="mt-1 text-[22px] font-bold leading-tight tracking-[-0.03em] text-foreground outline-none">
                        {step.title}
                    </h1>
                    <p className="mt-1.5 text-[13.5px] text-muted-foreground">{step.helper}</p>
                </div>

                {step.options && !step.multi && (
                    <Chips
                        labelledBy={titleId}
                        options={step.options}
                        selected={stepId === 'traded' ? (draft.traded === undefined ? [] : [draft.traded ? 'yes' : 'no']) : [String(draft[stepId] ?? '')]}
                        disabled={saving}
                        onToggle={pick}
                    />
                )}
                {stepId === 'tools' && (
                    <Chips labelledBy={titleId} options={TOOLS} selected={draft.tools} multi onToggle={(v) => setList('tools', toggle(draft.tools, v))} />
                )}
                {stepId === 'sectors' && (
                    <Chips
                        labelledBy={titleId}
                        options={listOptions(options.sectors.map((s) => s.name))}
                        selected={draft.sectors}
                        multi
                        onToggle={(v) => setList('sectors', toggle(draft.sectors, v))}
                    />
                )}
                {stepId === 'niches' && draft.sectors.filter((sector) => options.niches[sector]?.length).map((sector) => (
                    <div key={sector} className="flex flex-col gap-2">
                        <span id={`niche-${sector}`} className="form-label">{sector}</span>
                        <Chips
                            labelledBy={`niche-${sector}`}
                            options={listOptions(options.niches[sector])}
                            selected={draft.niches}
                            multi
                            onToggle={(v) => setList('niches', toggle(draft.niches, v))}
                        />
                    </div>
                ))}
                {stepId === 'themes' && (
                    <Chips labelledBy={titleId} options={listOptions(options.themes, themeLabel)} selected={draft.themes} multi onToggle={(v) => setList('themes', toggle(draft.themes, v))} />
                )}
                {stepId === 'brands' && (
                    <TickerPicker id="brands-search" label="Add a company" selected={draft.brands} onChange={(v) => setList('brands', v)} />
                )}
                {stepId === 'avoid' && (() => {
                    const sectorNames = options.sectors.map((s) => s.name);
                    return (
                        <>
                            <div className="flex flex-col gap-2">
                                <span id="avoid-sectors" className="form-label">Sectors to leave out</span>
                                <Chips
                                    labelledBy="avoid-sectors"
                                    options={listOptions(sectorNames)}
                                    selected={draft.avoid}
                                    multi
                                    onToggle={(v) => setList('avoid', toggle(draft.avoid, v))}
                                />
                            </div>
                            <TickerPicker
                                id="avoid-search"
                                label="Companies to leave out"
                                selected={draft.avoid.filter((v) => !sectorNames.includes(v))}
                                onChange={(symbols) => setList('avoid', [...draft.avoid.filter((v) => sectorNames.includes(v)), ...symbols])}
                            />
                        </>
                    );
                })()}
            </div>

            {error && <p role="alert" className="rounded-[10px] bg-down-soft px-3 py-2 text-[13px] font-semibold text-down">{error}</p>}

            <div className="flex items-center justify-between gap-3">
                {index === 0 && editing ? (
                    <Link href="/profile" className="btn btn-ghost"><ArrowLeft aria-hidden /> Back</Link>
                ) : (
                    <button type="button" className="btn btn-ghost" onClick={back} disabled={index === 0 || saving}>
                        <ArrowLeft aria-hidden /> Back
                    </button>
                )}
                <button type="submit" className="btn btn-primary" disabled={!canContinue || saving}>
                    {saving ? <Loader2 className="animate-spin" aria-hidden /> : null}
                    {index === ids.length - 1
                        ? (saving ? 'Computing…' : 'See my result')
                        : step.skippable && (draft[stepId] as string[]).length === 0 ? 'Skip' : 'Continue'}
                    {!saving && <ArrowRight aria-hidden />}
                </button>
            </div>
        </form>
    );
}
