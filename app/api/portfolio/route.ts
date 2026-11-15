import { respond } from '@/lib/services/http';
import { getPortfolio } from '@/lib/services/portfolio';

export const dynamic = 'force-dynamic';

export const GET = () => respond(getPortfolio);
