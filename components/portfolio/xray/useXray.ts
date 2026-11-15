'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Level, ProfileConfig } from '@/lib/domain/types';
import type { XrayView } from '@/lib/services/portfolio-xray';
import { useDataChanged } from '@/hooks/useDataChanged';
import { api } from '../logic';

/** The X-ray of the simulated portfolio, loaded in the browser (so a slow history provider never blocks a page). */
export function useXray(refreshKey = 0) {
    const [view, setView] = useState<XrayView | null>(null);
    const [error, setError] = useState<{ failure: unknown } | null>(null);

    const load = useCallback(async () => {
        try {
            setView(await api<XrayView>('/api/portfolio/xray'));
            setError(null);
        } catch (failure) {
            setError({ failure });
        }
    }, []);

    useEffect(() => { load(); }, [load, refreshKey]);
    // A change saved by the agent: computed again in place (the figures on screen stay meanwhile)
    useDataChanged(() => void load());
    return { view, error, load };
}

/** The user's level (Novice until the profile is read). */
export function useLevel(): Level {
    const [level, setLevel] = useState<Level>('Novice');
    const read = useCallback(() => {
        api<{ profile: ProfileConfig | null }>('/api/profile').then((got) => setLevel(got.profile?.level ?? 'Novice')).catch(() => undefined);
    }, []);
    useEffect(() => read(), [read]);
    useDataChanged(read);
    return level;
}
