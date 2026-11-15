import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { LOCALES } from '@/i18n/config';
import { agentText } from '@/lib/agent/text';
import { DEMO_USER } from '@/lib/demo-user';
import { failsWordCheck } from '@/lib/agent/wording';
import { clientIp, isRateLimited } from '@/lib/rate-limit';
import { ServiceError } from '@/lib/services/errors';
import { requestLocale, respond } from '@/lib/services/http';
import { AWS_REGION, signingCredentials } from '@/lib/voice/credentials';
import { assertSameOrigin, assertVoiceEnabled, voiceText } from '@/lib/voice/guard';
import { synthesizeSpeech } from '@/lib/voice/polly';
import { readLimitedText } from '@/lib/voice/body';
import { speakable } from '@/lib/voice/speakable';

export const dynamic = 'force-dynamic';

// A reply is read once; the limits only stop a script from using the endpoint as a free text-to-speech service.
// Polly is billed by the character, so the budget counts characters as well as requests. Per visitor (by address)
// and, since an address can be forged, a ceiling for everyone.
const MAX_PER_MINUTE_PER_IP = 20;
const MAX_CHARS_PER_HOUR_PER_IP = 60_000;
const MAX_PER_MINUTE = 60;
const MAX_CHARS_PER_HOUR = 240_000;
// 8000 characters of JSON text is at most about 48 KB once escaped
const MAX_BODY_BYTES = 64_000;
// Replies are at most a couple of thousand characters; speakable() cuts what is read down further.
// `language` is the reply's own (the agent answers in the language of the question); without one, the app's.
const schema = z.object({ text: z.string().min(1).max(8000), language: z.enum(LOCALES).optional() });

// An agent reply read aloud by Amazon Polly, in the language of the reply. The text is cleaned here (no source line, no
// file paths) and capped, so what is billed and spoken never depends on what the browser sends.
export const POST = (req: NextRequest) => respond(async () => {
    const appLocale = await requestLocale(req);
    assertVoiceEnabled(appLocale);
    assertSameOrigin(req, appLocale);
    const ip = clientIp(req);
    if (await isRateLimited(`voice-speak:ip:${ip}`, MAX_PER_MINUTE_PER_IP, 60)
        || await isRateLimited(`voice-speak:user:${DEMO_USER.id}`, MAX_PER_MINUTE, 60)) {
        throw new ServiceError(429, agentText(appLocale).tooMany);
    }
    // Requiring JSON also makes a cross-site form post impossible without a preflight
    if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
        throw new ServiceError(415, 'Send the text as application/json');
    }
    const { text, language } = schema.parse(JSON.parse(await readLimitedText(req, MAX_BODY_BYTES)));
    const locale = language ?? appLocale;
    const speech = speakable(text);
    if (!speech) return new NextResponse(null, { status: 204 });
    // The endpoint reads only what the app itself may say: the same bilingual check as on agent replies
    if (failsWordCheck(speech)) throw new ServiceError(400, voiceText(locale, 'wording'));
    if (await isRateLimited(`voice-speak-chars:ip:${ip}`, MAX_CHARS_PER_HOUR_PER_IP, 3600, speech.length)
        || await isRateLimited(`voice-speak-chars:user:${DEMO_USER.id}`, MAX_CHARS_PER_HOUR, 3600, speech.length)) {
        throw new ServiceError(429, agentText(locale).tooMany);
    }

    const audio = await synthesizeSpeech({ credentials: await signingCredentials(), region: AWS_REGION, text: speech, locale });
    return new NextResponse(audio, { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' } });
}, req);
