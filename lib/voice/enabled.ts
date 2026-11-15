'use client';

// Whether this server offers voice (VOICE_ENABLED, read by GET /api/voice/token at request time, so it changes per
// deployment without a rebuild). Asked once per page load; until the answer arrives, and when it cannot be had, voice
// counts as off, so the microphone and the speaker never appear on a server that refuses them.

import { useEffect, useState } from 'react';

let pending: Promise<boolean> | null = null;

export function fetchVoiceEnabled(fetcher: typeof fetch = fetch): Promise<boolean> {
    pending ??= fetcher('/api/voice/token', { method: 'GET', cache: 'no-store' })
        .then(async (response) => response.ok && (await response.json())?.enabled === true)
        .catch(() => { pending = null; return false; });
    return pending;
}

/** For tests: ask again on the next call. */
export function resetVoiceEnabled(): void { pending = null; }

/** null while asking, then true or false. */
export function useVoiceEnabled(): boolean | null {
    const [enabled, setEnabled] = useState<boolean | null>(null);
    useEffect(() => {
        let live = true;
        void fetchVoiceEnabled().then((on) => { if (live) setEnabled(on); });
        return () => { live = false; };
    }, []);
    return enabled;
}
