import { createHash, createHmac } from 'node:crypto';

// A SigV4 pre-signed URL for Amazon Transcribe streaming over a WebSocket. The browser opens it directly, so the
// AWS credentials stay on the server and the URL is only good for a few minutes.

export type SigningCredentials = { accessKeyId: string; secretAccessKey: string; sessionToken?: string };

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
const EMPTY_PAYLOAD_HASH = createHash('sha256').update('').digest('hex');

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const hmac = (key: string | Buffer, value: string) => createHmac('sha256', key).update(value).digest();
// RFC 3986: encodeURIComponent leaves !'()* alone, SigV4 does not
const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export function presignTranscribeUrl({ credentials, region, language, sampleRate, now = new Date(), expiresIn = 300 }: PresignInput): string {
    const host = `transcribestreaming.${region}.amazonaws.com:8443`;
    const stamp = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const day = stamp.slice(0, 8);
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
    const query = Object.keys(params).sort().map((key) => `${encode(key)}=${encode(params[key])}`).join('&');

    const canonical = ['GET', PATH, query, `host:${host}\n`, 'host', EMPTY_PAYLOAD_HASH].join('\n');
    const toSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256(canonical)].join('\n');
    const key = hmac(hmac(hmac(hmac(`AWS4${credentials.secretAccessKey}`, day), region), SERVICE), 'aws4_request');
    const signature = createHmac('sha256', key).update(toSign).digest('hex');

    return `wss://${host}${PATH}?${query}&X-Amz-Signature=${signature}`;
}
