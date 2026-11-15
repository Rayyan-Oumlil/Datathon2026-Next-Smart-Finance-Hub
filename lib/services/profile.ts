import { DEMO_USER } from '@/lib/demo-user';
import type { Level, OnboardingAnswers, ProfileConfig, Risk } from '@/lib/domain/types';
import { buildProfile } from '@/lib/rules/profile';
import { appendDecision, getProfile as readProfile, putProfile } from '@/lib/store';
import { ServiceError } from './errors';

export type ProfilePatch = {
    level?: Level | null;     // an explicit value is stored as an override; null drops the override
    risk?: Risk | null;
    answers?: Partial<OnboardingAnswers>;
};
export type ProfileEdit = { profile: ProfileConfig; before: { level: Level; risk: Risk }; after: { level: Level; risk: Risk } };

export const getProfile = (): Promise<ProfileConfig | null> => readProfile(DEMO_USER.id);

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
    const existing = await getProfile();
    const profile = buildProfile(DEMO_USER.id, answers, new Date().toISOString(), { createdAt: existing?.createdAt });
    await save(profile, 'onboarding', existing && levelAndRisk(existing), { answers });
    return profile;
}

/**
 * What an edit would give, without saving it. The rules always re-run on the merged answers. A level or risk
 * chosen by hand stays in place through later answer edits until another value, or null, is given.
 */
export async function previewProfileEdit(patch: ProfilePatch): Promise<ProfileEdit> {
    const existing = await getProfile();
    if (!existing) throw new ServiceError(404, 'No profile exists yet. Complete onboarding first.');
    const answers = { ...existing.answers, ...patch.answers };
    // Someone who has not traded was not asked about experience or tools
    if (!answers.traded) {
        delete answers.experience;
        delete answers.tools;
    }
    const keep = <T>(given: T | null | undefined, overridden: boolean, stored: T): T | undefined =>
        given === null ? undefined : given ?? (overridden ? stored : undefined);
    const profile = buildProfile(DEMO_USER.id, answers, new Date().toISOString(), {
        level: keep(patch.level, existing.levelOverridden, existing.level),
        risk: keep(patch.risk, existing.riskOverridden, existing.risk),
        createdAt: existing.createdAt,
    });
    return { profile, before: levelAndRisk(existing), after: levelAndRisk(profile) };
}

export async function editProfile(patch: ProfilePatch): Promise<ProfileEdit> {
    const edit = await previewProfileEdit(patch);
    await save(edit.profile, 'edit', edit.before, patch);
    return edit;
}
