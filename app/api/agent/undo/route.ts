import { NextRequest } from 'next/server';
import { z } from 'zod';
import { undoAction } from '@/lib/agent/chat';
import { respond } from '@/lib/services/http';

export const POST = (req: NextRequest) => respond(async () => {
    const { actionId } = z.object({ actionId: z.string().min(1).max(60) }).parse(await req.json());
    return undoAction(actionId);
});
