// Step 2 of an agent request: the context. Only data the app itself holds goes in: the request's language, the
// profile, the simulated holdings, today's watchlist picks, the layout and the stored strategies (names and rule kinds). Adanos sentiment and news text are
// never read here.

import type { Locale } from '@/i18n/config';
import { getAppLocale } from '@/i18n/locale';
import type { Level, OnboardingAnswers, Risk } from '@/lib/domain/types';
import type { Scope } from '@/lib/session';
import type { AgentPage } from './page';
import { getLayout } from '@/lib/services/layout';
import { getPortfolioState } from '@/lib/services/portfolio';
import { getProfile } from '@/lib/services/profile';
import { getWatchlist } from '@/lib/services/watchlist';
import { strategiesForContext } from './strategy-propose';

export type AgentContext = {
    locale: Locale;                 // the reply language: the agent service answers in it
    level?: Level;
    risk?: Risk;
    agentStyle?: OnboardingAnswers['agentStyle'];
    profile?: OnboardingAnswers;
    holdings: Array<{ symbol: string; quantity: number; sector?: string }>;
    watchlist: Array<{ rank: number; symbol: string; name: string; total: number }>;
    layout: string[];
    /** The visitor's stored strategies: id, name, version, rule count and rule kinds (no rule values). */
    strategies?: Array<{ id: string; name: string; version: number; rules: number; kinds: Record<string, number> }>;
    page?: AgentPage;               // the page the user is looking at, when it is one the app knows
};

/** `language` is the reply language (the message's own, see language.ts); without one the app's language is used. */
export async function buildContext(language: Locale | undefined, scope: Scope): Promise<{ context: AgentContext; snapshotId: string | null }> {
    const [profile, portfolio, watchlist, layout, locale, strategies] = await Promise.all([
        getProfile(undefined, scope), getPortfolioState(scope), getWatchlist(undefined, scope), getLayout(undefined, scope), language ?? getAppLocale(), strategiesForContext(scope),
    ]);
    const context: AgentContext = {
        locale,
        ...(profile ? { level: profile.level, risk: profile.risk, agentStyle: profile.answers.agentStyle, profile: profile.answers } : {}),
        holdings: portfolio.positions.map(({ symbol, quantity, sector }) => ({ symbol, quantity, ...(sector ? { sector } : {}) })),
        watchlist: (watchlist.result?.picks ?? []).map(({ rank, symbol, name, total }) => ({ rank, symbol, name, total })),
        layout: layout.layout,
        ...(strategies.length > 0 ? { strategies } : {}),     // left out when the visitor has none
    };
    return { context, snapshotId: watchlist.result?.snapshotId ?? null };
}
