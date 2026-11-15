import { NextRequest } from 'next/server';
import { z } from 'zod';
import { respond } from '@/lib/services/http';
import { createRule, listRules, setRuleStatus } from '@/lib/services/rules-engine';

export const dynamic = 'force-dynamic';

export const GET = () => respond(async () => ({ rules: await listRules() }));

export const POST = (req: NextRequest) => respond(async () => {
    const { rule } = z.object({ rule: z.unknown() }).parse(await req.json());
    return { rule: await createRule(rule) };
});

export const PATCH = (req: NextRequest) => respond(async () => {
    const { id, status } = z.object({ id: z.string().min(1).max(40), status: z.enum(['active', 'paused']) }).parse(await req.json());
    return { rule: await setRuleStatus(id, status) };
});
