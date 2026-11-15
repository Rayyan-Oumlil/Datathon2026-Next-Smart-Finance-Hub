import { NextRequest } from 'next/server';
import { z } from 'zod';
import { LOCALES } from '@/i18n/config';
import { undoAction } from '@/lib/agent/chat';
import { respond } from '@/lib/services/http';

export const POST = (req: NextRequest) => respond(async () => {
    const { actionId, language } = z.object({ actionId: z.string().min(1).max(60), language: z.enum(LOCALES).optional() }).parse(await req.json());
    return undoAction(actionId, language);
});
