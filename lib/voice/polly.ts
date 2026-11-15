import type { Locale } from '@/i18n/config';
import { amzStamp, assertRegion, sha256Hex, signature, signingKey, type SigningCredentials } from './sigv4';

// Amazon Polly text-to-speech over its REST API, signed with SigV4 headers. Written out here (as the Transcribe URL
// is) so voice needs no extra AWS package.

const SERVICE = 'polly';
const TIMEOUT_MS = 10_000;

// Neural voices: Joanna for English, Gabrielle for Canadian French
const VOICES: Record<Locale, { voiceId: string; languageCode: string }> = {
    en: { voiceId: 'Joanna', languageCode: 'en-US' },
    fr: { voiceId: 'Gabrielle', languageCode: 'fr-CA' },
};

export type PollyRequest = { url: string; headers: Record<string, string>; body: string };

export type PollyInput = { credentials: SigningCredentials; region: string; text: string; locale: Locale; now?: Date };

export function buildPollyRequest({ credentials, region, text, locale, now = new Date() }: PollyInput): PollyRequest {
    const host = `polly.${assertRegion(region)}.amazonaws.com`;
    const { stamp, day } = amzStamp(now);
    const voice = VOICES[locale];
    const body = JSON.stringify({ Engine: 'neural', LanguageCode: voice.languageCode, OutputFormat: 'mp3', Text: text, TextType: 'text', VoiceId: voice.voiceId });

    // Every header that is signed, lower-case, in alphabetical order
    const signed: Record<string, string> = {
        'content-type': 'application/json',
        host,
        'x-amz-date': stamp,
        ...(credentials.sessionToken ? { 'x-amz-security-token': credentials.sessionToken } : {}),
    };
    const names = Object.keys(signed).sort();
    const canonical = ['POST', '/v1/speech', '', ...names.map((name) => `${name}:${signed[name]}`), '', names.join(';'), sha256Hex(body)].join('\n');
    const scope = `${day}/${region}/${SERVICE}/aws4_request`;
    const toSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256Hex(canonical)].join('\n');
    const sig = signature(signingKey(credentials.secretAccessKey, day, region, SERVICE), toSign);

    return {
        url: `https://${host}/v1/speech`,
        body,
        headers: {
            'Content-Type': 'application/json',
            'X-Amz-Date': stamp,
            ...(credentials.sessionToken ? { 'X-Amz-Security-Token': credentials.sessionToken } : {}),
            Authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${sig}`,
        },
    };
}

/**
 * The spoken text as MP3 bytes. A refusal from Polly throws with its status and error type only (for the server log):
 * the response body can carry account and role names. A call that hangs is cut off, and a redirect is an error, so
 * the signed request is never sent anywhere else.
 */
export async function synthesizeSpeech(input: PollyInput): Promise<Uint8Array<ArrayBuffer>> {
    const request = buildPollyRequest(input);
    const response = await fetch(request.url, {
        method: 'POST',
        headers: request.headers,
        body: request.body,
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
        const type = (response.headers.get('x-amzn-errortype') ?? '').split(':')[0];
        throw new Error(`Polly ${response.status}${type ? ` ${type}` : ''}`);
    }
    return new Uint8Array(await response.arrayBuffer());
}
