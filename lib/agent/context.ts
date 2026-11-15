// Step 2 of an agent request: the context. Only data the app itself holds goes in: the request's language, the
// profile, the simulated holdings, today's watchlist picks and the layout. Adanos sentiment and news text are
// never read here.

import type { Locale } from '@/i18n/config';
import { getAppLocale } from '@/i18n/locale';
import type { Level, OnboardingAnswers, Risk } from '@/lib/domain/types';
import { getLayout } from '@/lib/services/layout';
import { getPortfolioState } from '@/lib/services/portfolio';
import { getProfile } from '@/lib/services/profile';
import { getWatchlist } from '@/lib/services/watchlist';

export type AgentContext = {
    locale: Locale;                 // the reply language: the agent service answers in it
    level?: Level;
    risk?: Risk;
    agentStyle?: OnboardingAnswers['agentStyle'];
    profile?: OnboardingAnswers;
    holdings: Array<{ symbol: string; quantity: number; sector?: string }>;
    watchlist: Array<{ rank: number; symbol: string; name: string; total: number }>;
    layout: string[];
};

/** `language` is the reply language (the message's own, see language.ts); without one the app's language is used. */
export async function buildContext(language?: Locale): Promise<{ context: AgentContext; snapshotId: string | null }> {
    const [profile, portfolio, watchlist, layout, locale] = await Promise.all([getProfile(), getPortfolioState(), getWatchlist(), getLayout(), language ?? getAppLocale()]);
    const context: AgentContext = {
        locale,
        ...(profile ? { level: profile.level, risk: profile.risk, agentStyle: profile.answers.agentStyle, profile: profile.answers } : {}),
        holdings: portfolio.positions.map(({ symbol, quantity, sector }) => ({ symbol, quantity, ...(sector ? { sector } : {}) })),
        watchlist: (watchlist.result?.picks ?? []).map(({ rank, symbol, name, total }) => ({ rank, symbol, name, total })),
        layout: layout.layout,
    };
    return { context, snapshotId: watchlist.result?.snapshotId ?? null };
}
