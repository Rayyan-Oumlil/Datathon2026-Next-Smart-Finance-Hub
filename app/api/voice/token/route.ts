import { NextRequest, NextResponse } from 'next/server';
import { agentText } from '@/lib/agent/text';
import { DEMO_USER } from '@/lib/demo-user';
import { isRateLimited } from '@/lib/rate-limit';
import { ServiceError } from '@/lib/services/errors';
import { requestLocale, respond } from '@/lib/services/http';
import { AWS_REGION, signingCredentials } from '@/lib/voice/credentials';
import { presignTranscribeUrl } from '@/lib/voice/presign';

export const dynamic = 'force-dynamic';

// One dictation asks once; the limit only stops a script from minting URLs in a loop.
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
    if (await isRateLimited(`voice:user:${DEMO_USER.id}`, MAX_PER_MINUTE, 60)) {
        throw new ServiceError(429, agentText(locale).tooMany);
    }
    const preferred = LANGUAGES[locale];
    const url = presignTranscribeUrl({ credentials: await signingCredentials(), region: AWS_REGION, language: { identify: OPTIONS, preferred }, sampleRate: SAMPLE_RATE, expiresIn: EXPIRES_IN });
    return NextResponse.json({ url, languages: OPTIONS, preferred, sampleRate: SAMPLE_RATE, expiresIn: EXPIRES_IN }, { headers: { 'Cache-Control': 'no-store' } });
}, req);
