import { NextRequest, NextResponse } from 'next/server';
import { getAppLocale } from '@/i18n/locale';
import { respond } from '@/lib/services/http';
import { chat } from '@/lib/agent/chat';
import { readAgentRequest } from '@/lib/agent/request';
import { encodeEvent } from '@/lib/agent/sse';
import { ServiceError } from '@/lib/services/errors';
import { renderText, serviceRef } from '@/lib/services/text';

export const dynamic = 'force-dynamic';
export const maxDuration = 150;

// no-transform keeps the compression layer from holding chunks back; the other header does the same for a proxy
const HEADERS = { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no' };

/**
 * The same request as /api/agent, answered as an event stream: a stage event as each step of the agent runs, then
 * one `final` event holding the reply once it has passed every check (the agent service's word and figure checks,
 * the guardrail, and this app's own wording check), or one `error` event. Nothing the checks refuse is ever sent.
 * A bad request or a request over the limit is answered as JSON before the stream starts, like /api/agent.
 */
export const POST = (req: NextRequest) => respond(async () => {
    const input = await readAgentRequest(req);
    const locale = await getAppLocale();
    const encoder = new TextEncoder();
    let open = true;

    const body = new ReadableStream<Uint8Array>({
        async start(controller) {
            // A browser that left cannot receive more; the request still runs to its end so its log stays complete
            const send = (event: unknown) => { if (open) controller.enqueue(encoder.encode(encodeEvent(event))); };
            try {
                send({ type: 'final', reply: await chat(input, send) });
            } catch (error) {
                const known = error instanceof ServiceError;
                if (!known) console.error('agent stream error:', error instanceof Error ? error.message : error);
                send({
                    type: 'error',
                    status: known ? error.status : 500,
                    message: known ? error.messageIn(locale) : renderText(serviceRef('svc.http.server_error', {}), locale),
                });
            } finally {
                if (open) controller.close();
            }
        },
        cancel() { open = false; },
    });
    return new NextResponse(body, { headers: HEADERS });
}, req);
