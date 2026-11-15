import { createHash, createHmac } from 'node:crypto';

// The small parts of AWS Signature Version 4 that the voice features share: the pre-signed Transcribe URL
// (presign.ts) and the signed Polly request (polly.ts).

export type SigningCredentials = { accessKeyId: string; secretAccessKey: string; sessionToken?: string };

export const sha256Hex = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');

const hmac = (key: string | Buffer, value: string): Buffer => createHmac('sha256', key).update(value).digest();

/** The derived signing key for one day, region and service. */
export const signingKey = (secretAccessKey: string, day: string, region: string, service: string): Buffer =>
    hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), service), 'aws4_request');

export const signature = (key: Buffer, stringToSign: string): string => createHmac('sha256', key).update(stringToSign).digest('hex');

/** 20261115T083000Z, and the day part 20261115. */
export const amzStamp = (now: Date): { stamp: string; day: string } => {
    const stamp = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    return { stamp, day: stamp.slice(0, 8) };
};

/** The region becomes part of a host name that gets a signed request, so it must look like an AWS region name. */
export const assertRegion = (region: string): string => {
    if (!/^[a-z]{2}(?:-[a-z]+)+-\d$/.test(region)) throw new Error(`Not an AWS region name: "${region}"`);
    return region;
};

/** RFC 3986 encoding: encodeURIComponent leaves !'()* alone, SigV4 does not. */
export const rfc3986 = (value: string): string =>
    encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
