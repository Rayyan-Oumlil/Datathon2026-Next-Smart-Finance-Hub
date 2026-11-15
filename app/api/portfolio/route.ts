import type { NextRequest } from 'next/server';
import { requestLocale, respond } from '@/lib/services/http';
import { getPortfolio } from '@/lib/services/portfolio';
import { requestScope } from '@/lib/session';

export const dynamic = 'force-dynamic';

// Notes, trade reasons and group names follow the request's language.
export const GET = (req: NextRequest) => respond(async () => getPortfolio(await requestLocale(req), await requestScope(req)), req);
