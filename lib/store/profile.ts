import type { ProfileConfig } from '@/lib/domain/types';
import { getBackend, plain, tables } from './client';

export async function getProfile(userId: string): Promise<ProfileConfig | null> {
    const item = await getBackend().get(tables.profile(), { userId });
    return (item as ProfileConfig | undefined) ?? null;
}

/** Overwrites the stored profile: profiles are editable by design. The change itself belongs in the decision log. */
export async function putProfile(profile: ProfileConfig): Promise<void> {
    await getBackend().put(tables.profile(), plain(profile));
}
