import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_SCOPE } from '@/__tests__/test-user';
import { listScopeDecisions } from '@/lib/session';
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
        const [logged] = await listScopeDecisions(TEST_SCOPE, { kind: 'profile_change' });
        expect(logged.ruleVersions).toEqual({ level: 'level-v1', risk: 'risk-v1' });
        expect(logged.payload).toMatchObject({ action: 'onboarding', answers: answers(), levelResult: { points: 2 }, riskResult: { points: 4 }, before: null, after: { level: 'Intermediate', risk: 'Medium' } });
    });

    it('re-runs the rules on an answer edit', async () => {
        await saveOnboarding(answers());
        const edit = await editProfile({ answers: { selfRating: 'high', drop20: 'buy_more' } });      // 1 + 1 + 2 + 2 = 6: High
        expect(edit).toMatchObject({ before: { level: 'Intermediate', risk: 'Medium' }, after: { level: 'Intermediate', risk: 'High' } });
        expect(edit.profile.answers.sectors).toEqual(answers().sectors);
        expect(await listScopeDecisions(TEST_SCOPE, { kind: 'profile_change' })).toHaveLength(2);
    });

    it('stores an explicit level as an override that survives later edits, until null drops it', async () => {
        await saveOnboarding(answers());
        expect((await editProfile({ level: 'Expert' })).profile).toMatchObject({ level: 'Expert', levelOverridden: true, levelResult: { level: 'Intermediate' } });
        expect((await editProfile({ answers: { markets: 'US' } })).profile).toMatchObject({ level: 'Expert', levelOverridden: true });
        expect((await editProfile({ level: null })).profile).toMatchObject({ level: 'Intermediate', levelOverridden: false });
    });

    it('refuses a risk override above the cap, in the preview and the edit, and saves nothing', async () => {
        await saveOnboarding(answers({ drop20: 'sell' }));
        const message = 'High is not available: you answered "reduce my position" to the 20% drop question, which limits the risk profile to Medium.';
        await expect(previewProfileEdit({ risk: 'High' })).rejects.toMatchObject({ status: 400, message });
        await expect(editProfile({ risk: 'High' })).rejects.toMatchObject({ status: 400, message });
        expect(await listScopeDecisions(TEST_SCOPE, { kind: 'profile_change' })).toHaveLength(1);
        expect((await editProfile({ risk: 'Low' })).profile).toMatchObject({ risk: 'Low', riskOverridden: true });
    });

    it('refuses an answer edit that would put a stored High override above the cap', async () => {
        await saveOnboarding(answers());
        await editProfile({ risk: 'High' });
        await expect(editProfile({ answers: { drop20: 'sell' } })).rejects.toMatchObject({ status: 400 });
        expect((await editProfile({ risk: null, answers: { drop20: 'sell' } })).profile).toMatchObject({ risk: 'Medium', riskOverridden: false });
    });

    it('previews without saving, and refuses an edit before onboarding', async () => {
        await expect(editProfile({ risk: 'Low' })).rejects.toMatchObject({ status: 404 });
        await saveOnboarding(answers());
        expect((await previewProfileEdit({ risk: 'Low' })).after).toEqual({ level: 'Intermediate', risk: 'Low' });
        expect((await getProfile())?.risk).toBe('Medium');
    });
});
