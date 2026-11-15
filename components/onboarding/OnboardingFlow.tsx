'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';
import type { Level, OnboardingAnswers, ProfileConfig, Risk } from '@/lib/domain/types';
import { formatPercent } from '@/i18n/format';
import { cn } from '@/lib/utils';
import { LevelBreakdown, RiskBreakdown, type RuleBands } from '@/components/profile/RuleBreakdown';
import Chips from './Chips';
import TickerPicker from './TickerPicker';
import { nicheLabel, optionsOf, sectorLabel, themeLabel, type Option, type OptionGroup } from './labels';

export type UniverseOptions = { sectors: Array<{ name: string; count: number }>; niches: Record<string, string[]>; themes: string[] };

type Draft = Partial<OnboardingAnswers> & { tools: string[]; sectors: string[]; niches: string[]; themes: string[]; brands: string[]; avoid: string[] };
type StepId =
    | 'goal' | 'traded' | 'experience' | 'tools' | 'investingGoal' | 'echeance' | 'drop20' | 'selfRating'
    | 'markets' | 'sectors' | 'niches' | 'themes' | 'brands' | 'avoid' | 'agentStyle';

const PARTS = ['about', 'risk', 'interests'] as const;

// The question and helper texts are messages under steps.<id> in the Onboarding namespace
const STEPS: Record<StepId, { part: number; group?: OptionGroup; multi?: boolean; skippable?: boolean }> = {
    goal: { part: 0, group: 'goal' },
    traded: { part: 0, group: 'traded' },
    experience: { part: 0, group: 'experience' },
    tools: { part: 0, group: 'tools', multi: true },
    investingGoal: { part: 1, group: 'investingGoal' },
    echeance: { part: 1, group: 'echeance' },
    drop20: { part: 1, group: 'drop20' },
    selfRating: { part: 1, group: 'selfRating' },
    markets: { part: 2, group: 'markets' },
    sectors: { part: 2, multi: true, skippable: true },
    niches: { part: 2, multi: true, skippable: true },
    themes: { part: 2, multi: true, skippable: true },
    brands: { part: 2, skippable: true },
    avoid: { part: 2, skippable: true },
    agentStyle: { part: 2, group: 'agentStyle' },
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
    const t = useTranslations('Onboarding');
    const tp = useTranslations('Profile');
    const locale = useLocale();
    const percent = formatPercent(20, locale);
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
            setError(t('saveError'));
        } finally {
            submitting.current = false;
            setSaving(false);
        }
    }, [saved, options.niches, t]);

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
                    <p className="kicker">{t('result.kicker')}</p>
                    <h1 ref={headingRef} tabIndex={-1} className="mt-1 text-[24px] font-bold leading-tight tracking-[-0.03em] text-foreground outline-none">
                        {t('result.heading', { level: tp('level', { level: profile.level }), risk: tp('risk', { risk: profile.risk }) })}
                    </h1>
                    <p className="mt-1.5 text-[13.5px] text-muted-foreground">
                        {t.rich('result.explain', {
                            levelRule: profile.ruleVersions.level,
                            riskRule: profile.ruleVersions.risk,
                            mono: (chunks) => <span className="mono">{chunks}</span>,
                        })}
                    </p>
                </div>

                {before && (
                    <p className="rounded-[10px] bg-hover px-3 py-2 text-[13px] text-foreground">
                        {t('result.beforeAfter', {
                            beforeLevel: tp('level', { level: before.level }),
                            beforeRisk: tp('risk', { risk: before.risk }),
                            afterLevel: tp('level', { level: profile.level }),
                            afterRisk: tp('risk', { risk: profile.risk }),
                        })}{' '}
                        {changed ? '' : t('result.noChange')}
                    </p>
                )}

                <section aria-labelledby="result-level" className="flex flex-col gap-2">
                    <h2 id="result-level" className="form-label">{t('result.whyLevel', { level: tp('level', { level: profile.levelResult.level }) })}</h2>
                    <LevelBreakdown profile={profile} bands={bands} />
                    {profile.levelOverridden && (
                        <p className="text-[13px] text-muted-foreground">{t('result.levelKept', { value: tp('level', { level: profile.level }) })}</p>
                    )}
                </section>

                <section aria-labelledby="result-risk" className="flex flex-col gap-2">
                    <h2 id="result-risk" className="form-label">{t('result.whyRisk', { risk: tp('risk', { risk: profile.riskResult.risk }) })}</h2>
                    <RiskBreakdown profile={profile} bands={bands} />
                    {profile.riskOverridden && (
                        <p className="text-[13px] text-muted-foreground">{t('result.riskKept', { value: tp('risk', { risk: profile.risk }) })}</p>
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
                        {t('result.editAnswers')}
                    </button>
                    <Link href="/start" className="btn btn-primary">
                        {t('result.seeSuggested')} <ArrowRight aria-hidden />
                    </Link>
                </div>
            </div>
        );
    }

    const titleId = `q-${stepId}`;
    const listOptions = (values: string[], label: (v: string) => string): Option[] => values.map((value) => ({ value, label: label(value) }));

    return (
        <form
            className="flex flex-col gap-6 p-5 sm:p-7"
            onSubmit={(e) => {
                e.preventDefault();
                if (canContinue && !saving) next(draft);
            }}
        >
            <ol className="grid grid-cols-3 gap-2" aria-label={t('progress')}>
                {PARTS.map((partId, part) => {
                    const name = t(`parts.${partId}`);
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
                    <p className="kicker">{t(step.skippable ? 'kickerOptional' : 'kicker', { part: t(`parts.${PARTS[step.part]}`), number: index + 1 })}</p>
                    <h1 id={titleId} ref={headingRef} tabIndex={-1} className="mt-1 text-[22px] font-bold leading-tight tracking-[-0.03em] text-foreground outline-none">
                        {t(`steps.${stepId}.title`, { percent })}
                    </h1>
                    <p className="mt-1.5 text-[13.5px] text-muted-foreground">{t(`steps.${stepId}.helper`, { percent })}</p>
                </div>

                {step.group && !step.multi && (
                    <Chips
                        labelledBy={titleId}
                        options={optionsOf(t, step.group)}
                        selected={stepId === 'traded' ? (draft.traded === undefined ? [] : [draft.traded ? 'yes' : 'no']) : [String(draft[stepId] ?? '')]}
                        disabled={saving}
                        onToggle={pick}
                    />
                )}
                {stepId === 'tools' && (
                    <Chips labelledBy={titleId} options={optionsOf(t, 'tools')} selected={draft.tools} multi onToggle={(v) => setList('tools', toggle(draft.tools, v))} />
                )}
                {stepId === 'sectors' && (
                    <Chips
                        labelledBy={titleId}
                        options={listOptions(options.sectors.map((s) => s.name), (v) => sectorLabel(t, v))}
                        selected={draft.sectors}
                        multi
                        onToggle={(v) => setList('sectors', toggle(draft.sectors, v))}
                    />
                )}
                {stepId === 'niches' && draft.sectors.filter((sector) => options.niches[sector]?.length).map((sector) => (
                    <div key={sector} className="flex flex-col gap-2">
                        <span id={`niche-${sector}`} className="form-label">{sectorLabel(t, sector)}</span>
                        <Chips
                            labelledBy={`niche-${sector}`}
                            options={listOptions(options.niches[sector], (v) => nicheLabel(t, v))}
                            selected={draft.niches}
                            multi
                            onToggle={(v) => setList('niches', toggle(draft.niches, v))}
                        />
                    </div>
                ))}
                {stepId === 'themes' && (
                    <Chips labelledBy={titleId} options={listOptions(options.themes, (v) => themeLabel(t, v))} selected={draft.themes} multi onToggle={(v) => setList('themes', toggle(draft.themes, v))} />
                )}
                {stepId === 'brands' && (
                    <TickerPicker id="brands-search" label={t('fields.addCompany')} selected={draft.brands} onChange={(v) => setList('brands', v)} />
                )}
                {stepId === 'avoid' && (() => {
                    const sectorNames = options.sectors.map((s) => s.name);
                    return (
                        <>
                            <div className="flex flex-col gap-2">
                                <span id="avoid-sectors" className="form-label">{t('fields.sectorsToLeaveOut')}</span>
                                <Chips
                                    labelledBy="avoid-sectors"
                                    options={listOptions(sectorNames, (v) => sectorLabel(t, v))}
                                    selected={draft.avoid}
                                    multi
                                    onToggle={(v) => setList('avoid', toggle(draft.avoid, v))}
                                />
                            </div>
                            <TickerPicker
                                id="avoid-search"
                                label={t('fields.companiesToLeaveOut')}
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
                    <Link href="/profile" className="btn btn-ghost"><ArrowLeft aria-hidden /> {t('actions.back')}</Link>
                ) : (
                    <button type="button" className="btn btn-ghost" onClick={back} disabled={index === 0 || saving}>
                        <ArrowLeft aria-hidden /> {t('actions.back')}
                    </button>
                )}
                <button type="submit" className="btn btn-primary" disabled={!canContinue || saving}>
                    {saving ? <Loader2 className="animate-spin" aria-hidden /> : null}
                    {index === ids.length - 1
                        ? (saving ? t('actions.computing') : t('actions.seeResult'))
                        : step.skippable && (draft[stepId] as string[]).length === 0 ? t('actions.skip') : t('actions.continue')}
                    {!saving && <ArrowRight aria-hidden />}
                </button>
            </div>
        </form>
    );
}
