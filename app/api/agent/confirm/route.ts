import { NextRequest } from 'next/server';
import { z } from 'zod';
import { confirm } from '@/lib/agent/chat';
import { respond } from '@/lib/services/http';

const schema = z.object({ actionId: z.string().min(1).max(60), accept: z.boolean() });

export const POST = (req: NextRequest) => respond(async () => {
    const { actionId, accept } = schema.parse(await req.json());
    return confirm(actionId, accept);
});
