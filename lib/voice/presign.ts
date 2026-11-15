import { amzStamp, assertRegion, rfc3986, sha256Hex, signature, signingKey, type SigningCredentials } from './sigv4';

// A SigV4 pre-signed URL for Amazon Transcribe streaming over a WebSocket. The browser opens it directly, so the
// AWS credentials stay on the server and the URL is only good for a short time.

export type { SigningCredentials };

export type PresignInput = {
    credentials: SigningCredentials;
    region: string;
    language: string;
    sampleRate: number;
    now?: Date;
    /** Seconds the URL stays valid; the service accepts at most 300. */
    expiresIn?: number;
};

const SERVICE = 'transcribe';
const PATH = '/stream-transcription-websocket';
const EMPTY_PAYLOAD_HASH = sha256Hex('');

export function presignTranscribeUrl({ credentials, region, language, sampleRate, now = new Date(), expiresIn = 300 }: PresignInput): string {
    const host = `transcribestreaming.${assertRegion(region)}.amazonaws.com:8443`;
    const { stamp, day } = amzStamp(now);
    const scope = `${day}/${region}/${SERVICE}/aws4_request`;

    const params: Record<string, string> = {
        'language-code': language,
        'media-encoding': 'pcm',
        'sample-rate': String(sampleRate),
        'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
        'X-Amz-Credential': `${credentials.accessKeyId}/${scope}`,
        'X-Amz-Date': stamp,
        'X-Amz-Expires': String(expiresIn),
        'X-Amz-SignedHeaders': 'host',
        ...(credentials.sessionToken ? { 'X-Amz-Security-Token': credentials.sessionToken } : {}),
    };
    const query = Object.keys(params).sort().map((key) => `${rfc3986(key)}=${rfc3986(params[key])}`).join('&');

    const canonical = ['GET', PATH, query, `host:${host}\n`, 'host', EMPTY_PAYLOAD_HASH].join('\n');
    const toSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256Hex(canonical)].join('\n');
    const sig = signature(signingKey(credentials.secretAccessKey, day, region, SERVICE), toSign);

    return `wss://${host}${PATH}?${query}&X-Amz-Signature=${sig}`;
}
