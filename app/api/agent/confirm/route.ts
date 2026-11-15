import { NextRequest } from 'next/server';
import { z } from 'zod';
import { LOCALES } from '@/i18n/config';
import { confirm } from '@/lib/agent/chat';
import { respond } from '@/lib/services/http';
import { requestScope } from '@/lib/session';

const schema = z.object({ actionId: z.string().min(1).max(60), accept: z.boolean(), language: z.enum(LOCALES).optional() });

export const POST = (req: NextRequest) => respond(async () => {
    const { actionId, accept, language } = schema.parse(await req.json());
    return confirm(actionId, accept, language, await requestScope(req));
}, req);
