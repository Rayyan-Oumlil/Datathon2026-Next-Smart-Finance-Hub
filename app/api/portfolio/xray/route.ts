import type { NextRequest } from 'next/server';
import { requestLocale, respond } from '@/lib/services/http';
import { getPortfolioXray } from '@/lib/services/portfolio-xray';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// The X-ray of the simulated portfolio. Read-only. Group names follow the request's language.
export const GET = (req: NextRequest) => respond(async () => getPortfolioXray(await requestLocale(req)), req);
