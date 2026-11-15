// Which storage ids a session reads and writes. Pure: no store access.
//
// A session goes through generations. Resetting never erases a row: it moves the session to a new generation, whose
// ids hold nothing yet, and the old rows stay where they were, readable under the old ids. Two counters are needed
// because a profile reset keeps the simulated portfolio and a portfolio reset keeps the profile:
//
//   `${sid}:p${p}`        the profile (profile_config row) and its profile_change decisions
//   `${sid}:f${f}`        the simulated portfolio: simulated_trade, profile_conflict and rule decisions
//   `${sid}:p${p}:f${f}`  what depends on both: the app-state document (rules, layout, watchlist state, agent
//                         previews), the watchlist runs, and the agent action log. It is also the userId the agent
//                         service receives and logs under.
//   `${sid}:session`      session-level events: the session_reset decisions

export type Generations = { profile: number; portfolio: number };

export type Scope = {
    sessionId: string;
    generations: Generations;
    profileUserId: string;
    portfolioUserId: string;
    scopeId: string;
    sessionLogId: string;
};

export const ZERO_GENERATIONS: Generations = { profile: 0, portfolio: 0 };

export const profileUserIdOf = (sessionId: string, profile: number): string => `${sessionId}:p${profile}`;
export const portfolioUserIdOf = (sessionId: string, portfolio: number): string => `${sessionId}:f${portfolio}`;
export const scopeIdOf = (sessionId: string, g: Generations): string => `${sessionId}:p${g.profile}:f${g.portfolio}`;
export const sessionLogIdOf = (sessionId: string): string => `${sessionId}:session`;

export function scopeFor(sessionId: string, generations: Generations): Scope {
    return {
        sessionId,
        generations: { ...generations },
        profileUserId: profileUserIdOf(sessionId, generations.profile),
        portfolioUserId: portfolioUserIdOf(sessionId, generations.portfolio),
        scopeId: scopeIdOf(sessionId, generations),
        sessionLogId: sessionLogIdOf(sessionId),
    };
}

const SCOPE_ID = /^([A-Za-z0-9_-]{1,64}):p(\d{1,6}):f(\d{1,6})$/;

/** The session and generations a scope id names, or null when it is not one. */
export function parseScopeId(id: unknown): { sessionId: string; generations: Generations } | null {
    if (typeof id !== 'string') return null;
    const match = SCOPE_ID.exec(id);
    if (!match) return null;
    return { sessionId: match[1], generations: { profile: Number(match[2]), portfolio: Number(match[3]) } };
}

export type ResetLevel = 'portfolio' | 'profile' | 'all';
export const RESET_LEVELS: readonly ResetLevel[] = ['portfolio', 'profile', 'all'];

/** The generations after a reset of this level. */
export function nextGenerations(g: Generations, level: ResetLevel): Generations {
    return {
        profile: level === 'portfolio' ? g.profile : g.profile + 1,
        portfolio: level === 'profile' ? g.portfolio : g.portfolio + 1,
    };
}

export const sameGenerations = (a: Generations, b: Generations): boolean => a.profile === b.profile && a.portfolio === b.portfolio;
