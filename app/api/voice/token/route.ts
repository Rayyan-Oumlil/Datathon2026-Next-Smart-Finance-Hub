import { NextRequest, NextResponse } from 'next/server';
import { agentText } from '@/lib/agent/text';
import { clientIp, isRateLimited } from '@/lib/rate-limit';
import { ServiceError } from '@/lib/services/errors';
import { requestLocale, respond } from '@/lib/services/http';
import { AWS_REGION, signingCredentials } from '@/lib/voice/credentials';
import { assertSameOrigin, assertVoiceEnabled, takeDailyUrl, voiceEnabled, voiceText } from '@/lib/voice/guard';
import { presignTranscribeUrl } from '@/lib/voice/presign';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

// One dictation asks once; the limits only stop a script from minting URLs in a loop. Per visitor (by address) and,
// since an address can be forged, a ceiling for everyone; a daily ceiling as well (lib/voice/guard.ts).
const MAX_PER_MINUTE_PER_IP = 6;
const MAX_PER_HOUR_PER_IP = 60;
const MAX_PER_MINUTE = 30;
const SAMPLE_RATE = 16000;
// The browser opens the socket within a second; a short life narrows the window in which a leaked URL can be replayed
const EXPIRES_IN = 60;

// The app speaks English and French (Transcribe streaming has no en-CA, so English is en-US). Whoever dictates may use
// either whatever the app is set to, so the service identifies which; the app's language is only the one it favours
// while it is not sure.
const LANGUAGES = { en: 'en-US', fr: 'fr-CA' } as const;
const OPTIONS = [LANGUAGES.en, LANGUAGES.fr];

// A short-lived signed WebSocket URL for Amazon Transcribe streaming. The languages are fixed here and signed into
// the URL, so the browser cannot ask for another one.
export const POST = (req: NextRequest) => respond(async () => {
    const locale = await requestLocale(req);
    assertVoiceEnabled(locale);
    assertSameOrigin(req, locale);
    const ip = clientIp(req);
    const limits: Array<[string, number, number]> = [
        [`voice:ip:${ip}:minute`, MAX_PER_MINUTE_PER_IP, 60],
        [`voice:ip:${ip}:hour`, MAX_PER_HOUR_PER_IP, 3600],
        [`voice:session:${(await getSession(req)).sessionId}`, MAX_PER_MINUTE, 60],
    ];
    for (const [key, max, window] of limits) {
        if (await isRateLimited(key, max, window)) throw new ServiceError(429, agentText(locale).tooMany);
    }
    if (!takeDailyUrl()) throw new ServiceError(429, voiceText(locale, 'dailyCap'));
    const preferred = LANGUAGES[locale];
    const url = presignTranscribeUrl({ credentials: await signingCredentials(), region: AWS_REGION, language: { identify: OPTIONS, preferred }, sampleRate: SAMPLE_RATE, expiresIn: EXPIRES_IN });
    return NextResponse.json({ url, languages: OPTIONS, preferred, sampleRate: SAMPLE_RATE, expiresIn: EXPIRES_IN }, { headers: { 'Cache-Control': 'no-store' } });
}, req);

// Whether this server offers voice at all (VOICE_ENABLED, read now): the panel shows the microphone and the speaker
// only when it does.
export const GET = () => NextResponse.json({ enabled: voiceEnabled() }, { headers: { 'Cache-Control': 'no-store' } });
