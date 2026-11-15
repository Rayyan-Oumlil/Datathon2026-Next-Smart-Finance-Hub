// Shared by the service tests: the in-memory store, a throwaway app-state file, and stubbed market data.
import { mkdtempSync } from 'fs';
import os from 'os';
import path from 'path';
import type { OnboardingAnswers } from '@/lib/domain/types';
import { TEST_SCOPE } from '@/__tests__/test-user';
import { buildProfile } from '@/lib/rules/profile';
import { putProfile } from '@/lib/store';
import { resetMemoryStore } from '@/lib/store/memory';
import { resetPortfolioCache } from '@/lib/services/portfolio';
import { resetWatchlistMemory } from '@/lib/services/watchlist';
import { NOW, market } from './market-stub';

export { NOW, market, passing, sourced } from './market-stub';

export function answers(over: Partial<OnboardingAnswers> = {}): OnboardingAnswers {
    return {
        goal: 'find ideas', traded: true, experience: '1-5y', tools: ['limit_or_stop'],            // 2 points: Intermediate
        investingGoal: 'growth', echeance: '1 yr', drop20: 'wait', selfRating: 'medium',           // 4 points: Medium
        markets: 'global', sectors: ['Information Technology', 'Energy'], niches: [], themes: [], brands: ['AAPL', 'SHOP.TO'], avoid: [],
        agentStyle: 'just the data',
        ...over,
    };
}

/** Empty store, empty app-state file, default market, and (unless told otherwise) a Medium-risk Intermediate profile. */
export async function freshWorld(withProfile = true): Promise<void> {
    process.env.APP_STATE_FILE = path.join(mkdtempSync(path.join(os.tmpdir(), 'services-test-')), 'app-state.json');
    resetMemoryStore();
    resetPortfolioCache();
    resetWatchlistMemory();
    market.prices = { AAPL: { value: 100, currency: 'USD', change: 10 }, 'RY.TO': { value: 50, currency: 'CAD', change: 0 }, BTC: { value: 90000, currency: 'CAD' } };
    market.fx = 1.42;
    market.signals = {};
    market.closes = {};
    market.fxHistory = [];
    if (withProfile) await putProfile(buildProfile(TEST_SCOPE.profileUserId, answers(), NOW));
}
