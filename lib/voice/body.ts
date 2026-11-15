import { ServiceError } from '@/lib/services/errors';

/**
 * The text of a request body, refusing with a 413 as soon as it is over maxBytes. `await req.json()` would buffer a
 * body of any size before a schema could say no; this stops reading at the limit.
 */
export async function readLimitedText(req: Request, maxBytes: number): Promise<string> {
    const declared = Number(req.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) throw new ServiceError(413, 'Request too large');
    if (!req.body) return '';

    const reader = req.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
            await reader.cancel();
            throw new ServiceError(413, 'Request too large');
        }
        chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
    return new TextDecoder().decode(bytes);
}
