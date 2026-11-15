import { getAppLocale } from '@/i18n/locale';
import { DEMO_USER } from '@/lib/demo-user';
import type { Level, OnboardingAnswers, ProfileConfig, Risk } from '@/lib/domain/types';
import { buildProfile } from '@/lib/rules/profile';
import { localizeCappedBy, overrideCapRefusalRef } from '@/lib/rules/risk';
import { appendDecision, getProfile as readProfile, putProfile } from '@/lib/store';
import type { Locale } from '@/lib/watchlist/text';
import { ServiceError } from './errors';
import { serviceRef } from './text';

export type ProfilePatch = {
    level?: Level | null;     // an explicit value is stored as an override; null drops the override
    risk?: Risk | null;
    answers?: Partial<OnboardingAnswers>;
};
export type ProfileEdit = { profile: ProfileConfig; before: { level: Level; risk: Risk }; after: { level: Level; risk: Risk } };

/**
 * A profile for display in a language: the stored profile keeps the rules file's English wording of a risk cap
 * (riskResult.cappedBy); this gives it in `locale`. Level and risk stay the English identifiers.
 */
export function localizeProfile(profile: ProfileConfig, locale: Locale): ProfileConfig {
    const { cappedBy } = profile.riskResult;
    if (cappedBy === undefined) return profile;
    return { ...profile, riskResult: { ...profile.riskResult, cappedBy: localizeCappedBy(cappedBy, locale) } };
}

/** The stored profile, its display text in `locale` (default: the request's language). */
export async function getProfile(locale?: Locale): Promise<ProfileConfig | null> {
    const profile = await readProfile(DEMO_USER.id);
    return profile && localizeProfile(profile, locale ?? await getAppLocale());
}

const levelAndRisk = (profile: ProfileConfig) => ({ level: profile.level, risk: profile.risk });

async function save(profile: ProfileConfig, action: string, before: { level: Level; risk: Risk } | null, change: unknown): Promise<void> {
    await putProfile(profile);
    await appendDecision({
        userId: profile.userId,
        kind: 'profile_change',
        ruleVersions: profile.ruleVersions,
        payload: {
            action,
            change,
            answers: profile.answers,
            levelResult: profile.levelResult,
            riskResult: profile.riskResult,
            levelOverridden: profile.levelOverridden,
            riskOverridden: profile.riskOverridden,
            before,
            after: levelAndRisk(profile),
        },
    });
}

/** Onboarding result: the Level and Risk rules run here, on the server, on the answers as given. */
export async function saveOnboarding(answers: OnboardingAnswers): Promise<ProfileConfig> {
    const existing = await readProfile(DEMO_USER.id);
    const profile = buildProfile(DEMO_USER.id, answers, new Date().toISOString(), { createdAt: existing?.createdAt });
    await save(profile, 'onboarding', existing && levelAndRisk(existing), { answers });
    return profile;
}

/**
 * What an edit would give, without saving it. The rules always re-run on the merged answers. A level or risk
 * chosen by hand stays in place through later answer edits until another value, or null, is given.
 */
export async function previewProfileEdit(patch: ProfilePatch): Promise<ProfileEdit> {
    const existing = await readProfile(DEMO_USER.id);
    if (!existing) throw new ServiceError(404, serviceRef('svc.no_profile', {}));
    const answers = { ...existing.answers, ...patch.answers };
    // Someone who has not traded was not asked about experience or tools
    if (!answers.traded) {
        delete answers.experience;
        delete answers.tools;
    }
    const keep = <T>(given: T | null | undefined, overridden: boolean, stored: T): T | undefined =>
        given === null ? undefined : given ?? (overridden ? stored : undefined);
    const risk = keep(patch.risk, existing.riskOverridden, existing.risk);
    // The risk caps hold for a risk chosen by hand too
    const refusal = risk && overrideCapRefusalRef(risk, answers);
    if (refusal) throw new ServiceError(400, refusal);
    const profile = buildProfile(DEMO_USER.id, answers, new Date().toISOString(), {
        level: keep(patch.level, existing.levelOverridden, existing.level),
        risk,
        createdAt: existing.createdAt,
    });
    return { profile, before: levelAndRisk(existing), after: levelAndRisk(profile) };
}

export async function editProfile(patch: ProfilePatch): Promise<ProfileEdit> {
    const edit = await previewProfileEdit(patch);
    await save(edit.profile, 'edit', edit.before, patch);
    return edit;
}
