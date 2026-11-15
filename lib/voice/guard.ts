// What both voice routes check before they spend anything: the server-side switch, the origin of the request, and
// (for Transcribe) a daily ceiling on minted URLs. The texts come from messages/<locale>/AgentPanel.json.

import type { Locale } from '@/i18n/config';
import en from '@/messages/en/AgentPanel.json';
import fr from '@/messages/fr/AgentPanel.json';
import { ServiceError } from '@/lib/services/errors';

type Env = Record<string, string | undefined>;

/**
 * VOICE_ENABLED, read at every request so a deployment can change it without a rebuild. 'true' turns voice on;
 * any other value turns it off. Unset (or empty): on in development, off in production.
 */
export function voiceEnabled(env: Env = process.env): boolean {
    const value = env.VOICE_ENABLED?.trim();
    if (!value) return env.NODE_ENV !== 'production';
    return value.toLowerCase() === 'true';
}

export type VoiceRefusal = keyof typeof en.voice.server;
export const voiceText = (locale: Locale, key: VoiceRefusal): string => (locale === 'fr' ? fr : en).voice.server[key];

/** Throws a 404 when voice is off on this server: nothing is minted or synthesized. */
export function assertVoiceEnabled(locale: Locale): void {
    if (!voiceEnabled()) throw new ServiceError(404, voiceText(locale, 'off'));
}

/**
 * Throws a 403 when the request carries an Origin whose host is not the request's own Host. A request without an
 * Origin header (a same-origin GET, curl) passes; an Origin that cannot be read ("null") does not.
 */
export function assertSameOrigin(req: { headers: Headers }, locale: Locale): void {
    const origin = req.headers.get('origin');
    if (origin === null) return;
    let originHost: string | null = null;
    try { originHost = new URL(origin).host.toLowerCase(); } catch { originHost = null; }
    const host = (req.headers.get('host') ?? '').trim().toLowerCase();
    if (!originHost || !host || originHost !== host) throw new ServiceError(403, voiceText(locale, 'crossOrigin'));
}

// Each Transcribe URL can stream for minutes and is billed per minute; this caps one server process per UTC day.
export const MAX_URLS_PER_DAY = 300;
let day = '';
let minted = 0;

/** Counts one minted URL against today's ceiling; false (and nothing counted) once the ceiling is reached. */
export function takeDailyUrl(now: Date = new Date()): boolean {
    const today = now.toISOString().slice(0, 10);
    if (today !== day) { day = today; minted = 0; }
    if (minted >= MAX_URLS_PER_DAY) return false;
    minted += 1;
    return true;
}

/** For tests: forget today's count. */
export function resetDailyUrls(): void { day = ''; minted = 0; }
