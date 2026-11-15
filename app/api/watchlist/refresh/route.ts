import { respond } from '@/lib/services/http';
import { buildWatchlist } from '@/lib/services/watchlist';

export const POST = () => respond(async () => {
    await buildWatchlist();
    return { started: true };
});
