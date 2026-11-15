import { NextRequest } from 'next/server';
import { chat } from '@/lib/agent/chat';
import { readAgentRequest } from '@/lib/agent/request';
import { respond } from '@/lib/services/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 150;

// The web side of one agent request. The reply never applies anything: a change comes back as a preview.
// The same request as an event stream, with the stages shown while it runs, is /api/agent/stream.
export const POST = (req: NextRequest) => respond(async () => chat(await readAgentRequest(req)));
