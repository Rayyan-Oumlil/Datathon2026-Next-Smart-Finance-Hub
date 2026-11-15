import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_USER } from '@/lib/demo-user';
import { listDecisions } from '@/lib/store';
import { editProfile, getProfile, previewProfileEdit, saveOnboarding } from '@/lib/services/profile';
import { answers, freshWorld } from './helpers';

vi.mock('@/lib/services/quotes', async (original) => (await import('./market-stub')).quotesMock(await original()));

beforeEach(() => freshWorld(false));

describe('profile service', () => {
    it('runs the rules on save and logs the answers, results and rule versions', async () => {
        const profile = await saveOnboarding(answers());
        expect(profile).toMatchObject({ level: 'Intermediate', risk: 'Medium', levelOverridden: false });
        expect(await getProfile()).toEqual(profile);
        const [logged] = await listDecisions(DEMO_USER.id, { kind: 'profile_change' });
        expect(logged.ruleVersions).toEqual({ level: 'level-v1', risk: 'risk-v1' });
        expect(logged.payload).toMatchObject({ action: 'onboarding', answers: answers(), levelResult: { points: 2 }, riskResult: { points: 4 }, before: null, after: { level: 'Intermediate', risk: 'Medium' } });
    });

    it('re-runs the rules on an answer edit', async () => {
        await saveOnboarding(answers());
        const edit = await editProfile({ answers: { selfRating: 'high', drop20: 'buy_more' } });      // 1 + 1 + 2 + 2 = 6: High
        expect(edit).toMatchObject({ before: { level: 'Intermediate', risk: 'Medium' }, after: { level: 'Intermediate', risk: 'High' } });
        expect(edit.profile.answers.sectors).toEqual(answers().sectors);
        expect(await listDecisions(DEMO_USER.id, { kind: 'profile_change' })).toHaveLength(2);
    });

    it('stores an explicit level as an override that survives later edits, until null drops it', async () => {
        await saveOnboarding(answers());
        expect((await editProfile({ level: 'Expert' })).profile).toMatchObject({ level: 'Expert', levelOverridden: true, levelResult: { level: 'Intermediate' } });
        expect((await editProfile({ answers: { markets: 'US' } })).profile).toMatchObject({ level: 'Expert', levelOverridden: true });
        expect((await editProfile({ level: null })).profile).toMatchObject({ level: 'Intermediate', levelOverridden: false });
    });

    it('previews without saving, and refuses an edit before onboarding', async () => {
        await expect(editProfile({ risk: 'Low' })).rejects.toMatchObject({ status: 404 });
        await saveOnboarding(answers());
        expect((await previewProfileEdit({ risk: 'Low' })).after).toEqual({ level: 'Intermediate', risk: 'Low' });
        expect((await getProfile())?.risk).toBe('Medium');
    });
});
