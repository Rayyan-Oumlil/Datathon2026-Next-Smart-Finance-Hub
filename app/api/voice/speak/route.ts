import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { agentText } from '@/lib/agent/text';
import { DEMO_USER } from '@/lib/demo-user';
import { isRateLimited } from '@/lib/rate-limit';
import { ServiceError } from '@/lib/services/errors';
import { requestLocale, respond } from '@/lib/services/http';
import { AWS_REGION, signingCredentials } from '@/lib/voice/credentials';
import { synthesizeSpeech } from '@/lib/voice/polly';
import { speakable } from '@/lib/voice/speakable';

export const dynamic = 'force-dynamic';

// A reply is read once; the limit only stops a script from using the endpoint as a free text-to-speech service.
const MAX_PER_MINUTE = 30;
// Replies are at most a couple of thousand characters; speakable() cuts what is read down further
const schema = z.object({ text: z.string().min(1).max(8000) });

// An agent reply read aloud by Amazon Polly, in the app's language. The text is cleaned here (no source line, no file
// paths) and capped, so what is billed and spoken never depends on what the browser sends.
export const POST = (req: NextRequest) => respond(async () => {
    const locale = await requestLocale(req);
    if (await isRateLimited(`voice-speak:user:${DEMO_USER.id}`, MAX_PER_MINUTE, 60)) {
        throw new ServiceError(429, agentText(locale).tooMany);
    }
    const { text } = schema.parse(await req.json());
    const speech = speakable(text);
    if (!speech) return new NextResponse(null, { status: 204 });

    const audio = await synthesizeSpeech({ credentials: await signingCredentials(), region: AWS_REGION, text: speech, locale });
    return new NextResponse(audio, { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' } });
}, req);
