import { respond } from '@/lib/services/http';
import { getWatchlist } from '@/lib/services/watchlist';

export const dynamic = 'force-dynamic';

// Never waits on a build: with no run for today it starts one and answers building: true
export const GET = () => respond(getWatchlist);
