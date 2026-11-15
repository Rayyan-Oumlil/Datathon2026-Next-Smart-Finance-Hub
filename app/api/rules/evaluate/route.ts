import type { NextRequest } from 'next/server';
import { requestLocale, respond } from '@/lib/services/http';
import { evaluateRules } from '@/lib/services/rules-engine';

// Check notes and trade reasons follow the request's language.
export const POST = (req: NextRequest) => respond(async () => evaluateRules(await requestLocale(req)), req);
