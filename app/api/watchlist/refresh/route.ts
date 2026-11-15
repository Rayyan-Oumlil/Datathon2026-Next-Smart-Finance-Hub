import { respond } from '@/lib/services/http';
import { refreshWatchlist } from '@/lib/services/watchlist';

// Once a day: { started: false, reason } when today's run for the current profile already exists
export const POST = () => respond(() => refreshWatchlist());
