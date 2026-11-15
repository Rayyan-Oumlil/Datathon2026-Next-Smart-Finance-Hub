// Step 2 of an agent request: the context. Only data the app itself holds goes in: the profile, the simulated
// holdings, today's watchlist picks and the layout. Adanos sentiment and news text are never read here.

import type { Level, OnboardingAnswers, Risk } from '@/lib/domain/types';
import { getLayout } from '@/lib/services/layout';
import { getPortfolioState } from '@/lib/services/portfolio';
import { getProfile } from '@/lib/services/profile';
import { getWatchlist } from '@/lib/services/watchlist';

export type AgentContext = {
    level?: Level;
    risk?: Risk;
    agentStyle?: OnboardingAnswers['agentStyle'];
    profile?: OnboardingAnswers;
    holdings: Array<{ symbol: string; quantity: number; sector?: string }>;
    watchlist: Array<{ rank: number; symbol: string; name: string; total: number }>;
    layout: string[];
};

export async function buildContext(): Promise<{ context: AgentContext; snapshotId: string | null }> {
    const [profile, portfolio, watchlist, layout] = await Promise.all([getProfile(), getPortfolioState(), getWatchlist(), getLayout()]);
    const context: AgentContext = {
        ...(profile ? { level: profile.level, risk: profile.risk, agentStyle: profile.answers.agentStyle, profile: profile.answers } : {}),
        holdings: portfolio.positions.map(({ symbol, quantity, sector }) => ({ symbol, quantity, ...(sector ? { sector } : {}) })),
        watchlist: (watchlist.result?.picks ?? []).map(({ rank, symbol, name, total }) => ({ rank, symbol, name, total })),
        layout: layout.layout,
    };
    return { context, snapshotId: watchlist.result?.snapshotId ?? null };
}
