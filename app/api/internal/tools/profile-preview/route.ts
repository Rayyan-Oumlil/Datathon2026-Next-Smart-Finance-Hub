import { z } from 'zod';
import { internalTool } from '@/lib/agent/internal';
import { profileChangesSchema, toProfilePatch } from '@/lib/agent/profile-changes';
import { previewProfileEdit } from '@/lib/services/profile';

// Re-runs the Level and Risk rules on the changed answers. Nothing is saved.
export const POST = internalTool(z.object({ changes: profileChangesSchema }), async ({ changes }) => {
    const { profile, before, after } = await previewProfileEdit(toProfilePatch(changes));
    return { before, after, levelResult: profile.levelResult, riskResult: profile.riskResult, levelOverridden: profile.levelOverridden, riskOverridden: profile.riskOverridden };
});
