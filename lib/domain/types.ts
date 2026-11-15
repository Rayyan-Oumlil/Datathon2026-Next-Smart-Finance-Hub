// Shared shapes for the profile, the smart watchlist pipeline, the logs and the agent.
// Every module imports from here so the stores, the pipeline, the UI and the agent agree on field names.

// A local name for TypeScript's own Pick, because this file exports a domain type called Pick (a watchlist pick).
type Subset<T, K extends keyof T> = { [P in K]: T[P] };

// ---------------------------------------------------------------- provenance

/** One external or derived value, with where and when it came from. Nothing is shown or scored without this. */
export type Sourced<T = number> = {
    value: T;
    unit?: string;            // '%', 'USD', 'CAD', 'ratio', 'USD millions' ...
    currency?: string;
    source: string;           // 'Finnhub', 'Yahoo chart (unofficial)', 'TMX Money (delayed 15 min or more)', 'Bank of Canada', 'Kraken', 'derived', 'demo data' ...
    endpoint?: string;        // URL or endpoint name, never with a key
    fetchedAt: string;        // ISO time we fetched or computed it
    asOf?: string;            // the provider's own timestamp or date, when it gives one
    note?: string;
};

// ---------------------------------------------------------------- profile

export type Level = 'Novice' | 'Intermediate' | 'Expert';
export type Risk = 'Low' | 'Medium' | 'High';
export type Market = 'US' | 'Canada' | 'global';

/** Answers exactly as given in onboarding. Keys match rules/v1.json. */
export type OnboardingAnswers = {
    goal: 'learn' | 'track' | 'find ideas';
    traded: boolean;
    experience?: '<1y' | '1-5y' | '5+y';                                  // only when traded
    tools?: Array<'limit_or_stop' | 'options' | 'margin_or_shorting'>;    // only when traded
    investingGoal: 'income' | 'growth' | 'trading';
    echeance: 'weeks' | 'months' | '1 yr' | '5+ yrs';
    drop20: 'sell' | 'wait' | 'buy_more';
    selfRating: 'low' | 'medium' | 'high';
    markets: Market;
    sectors: string[];        // sector ids from data/universe (GICS sector names)
    niches: string[];         // GICS sub-industry names
    themes: string[];         // 'AI' | 'clean energy' | 'dividends' | 'ESG'
    brands: string[];         // tickers
    avoid: string[];          // tickers or sector names
    agentStyle: 'teach me' | 'suggest' | 'just the data';
};

export type LevelResult = { level: Level; points: number; breakdown: Record<string, number>; ruleVersion: string };
export type RiskResult = {
    risk: Risk;
    points: number;
    breakdown: Record<string, number>;
    cappedBy?: string;        // e.g. '"Sell" on the drop question can never give High'
    selfRated: Risk;
    differsFromSelfRating: boolean;
    ruleVersion: string;
};

export type ProfileConfig = {
    userId: string;
    answers: OnboardingAnswers;
    level: Level;             // may be overridden on the Profile tab
    risk: Risk;               // may be overridden on the Profile tab
    levelResult: LevelResult; // what the rule computed
    riskResult: RiskResult;
    levelOverridden: boolean;
    riskOverridden: boolean;
    ruleVersions: { level: string; risk: string };
    createdAt: string;
    updatedAt: string;
};

// ---------------------------------------------------------------- universe and signals

export type AssetClass = 'stock' | 'etf' | 'crypto' | 'gold' | 'bond_yield';
export type EsgTag = 'screened' | 'not screened' | 'controversy';

/** One row of data/universe.json: a candidate, before any market data. */
export type UniverseEntry = {
    symbol: string;           // app symbol: 'AAPL', 'RY.TO', 'XIU.TO', 'BTC', 'GOLD', 'CA5Y'
    name: string;
    assetClass: AssetClass;
    market: 'US' | 'Canada' | 'none';
    sector?: string;          // GICS sector name for stocks; undefined for ETFs, crypto, gold, yields
    subIndustry?: string;     // GICS sub-industry (the "niche")
    themes: string[];         // hand-set theme tags, labelled as such
    esg: EsgTag;              // mock, hand-set: always shown as "demo data"
    blueChipEtf?: boolean;    // on the broad-index ETF list
    etf?: { index: string; holdings?: number; issuerUrl: string };
    listSource: string;       // where this row came from, e.g. 'Wikipedia: List of S&P 500 companies, rev 123, 2026-10-19 (CC BY-SA 4.0)'
};

/** All inputs for one candidate, collected once. This is what the decision log stores. */
export type SignalSet = {
    symbol: string;
    entry: UniverseEntry;
    price?: Sourced;
    changePercent?: Sourced;
    marketCapUsd?: Sourced;        // converted with the Bank of Canada rate when the source is in CAD (note says so)
    avgDailyTradedValueUsd?: Sourced;
    volatility1y?: Sourced;        // annualized, as a fraction (0.24 = 24%)
    beta?: Sourced;
    pe?: Sourced;
    revenueGrowthPct?: Sourced;
    sectorLabel?: Sourced<string>; // provider's label when we have one; otherwise the list's
    closes1m?: Sourced<number[]> & { dates?: string[] };  // for the sparkline; dates (YYYY-MM-DD) line up with the closes, absent in older logged runs
    newsCount7d?: Sourced;         // shown, never scored
    missing: string[];             // names of signals we could not get, with no value invented
};

export type HoldingsSummary = {
    totalValueCad: number;
    bySector: Record<string, number>;       // sector -> value in CAD
    byAssetClass: Record<string, number>;
    symbols: string[];
};

export type Snapshot = {
    id: string;
    takenAt: string;
    userId: string;
    profile: Subset<ProfileConfig, 'level' | 'risk' | 'answers' | 'ruleVersions'>;
    holdings: HoldingsSummary;
    fxUsdCad?: Sourced;
    signals: SignalSet[];
};

// ---------------------------------------------------------------- display text

/**
 * The structured form of a sentence shown to the user: a catalog key and the values it is filled with. The
 * sentence itself is a pure function of this pair and the language (lib/watchlist/text.ts, lib/services/text.ts),
 * so a logged run can be read again in English or French. Names in params stay the stable English identifiers
 * ('Medium', 'etf', 'Information Technology'); the catalog turns them into display names.
 */
export type TextParam = string | number | boolean | null | TextRef | Array<string | TextRef>;
export type TextRef = { key: string; params?: Record<string, TextParam> };

// ---------------------------------------------------------------- pipeline results

export type FilterCheck = {
    filter: 'avoid_list' | 'markets' | 'volatility' | 'market_cap_floor' | 'liquidity' | 'esg' | 'novice' | 'low_risk_etf' | 'crypto_risk' | 'data';
    pass: boolean;
    detail: string;           // plain fact with the actual values: 'volatility 41.2% vs cap 35.0% (Medium)'
    value?: number;
    limit?: number;
    textRef?: TextRef;        // the detail's catalog key and values, to render it in another language
};

export type FactorScores = { profile_fit: number; risk_fit: number; fundamentals: number; diversification: number };
export type FactorDetail = { score: number; detail: string; noData?: boolean; textRef?: TextRef };

export type Candidate = {
    symbol: string;
    signals: SignalSet;
    filters: FilterCheck[];
    passed: boolean;
    factors?: Record<keyof FactorScores, FactorDetail>;
    total?: number;           // 0-100
};

export type ReasonSentence = { templateId: string; text: string; sources: string[]; textRef?: TextRef };

export type Pick = {
    rank: number;
    symbol: string;
    name: string;
    assetClass: AssetClass;
    sector?: string;
    total: number;
    factors: Record<keyof FactorScores, FactorDetail>;
    topDrivers: Array<keyof FactorScores>;
    reason: ReasonSentence | null;      // null -> the card shows facts only
    kept?: 'seed' | 'incumbent' | 'new';
    signals: SignalSet;
};

/** Same type under a name that does not shadow TypeScript's Pick. Prefer this one in new code. */
export type WatchlistPick = Pick;

export type WatchlistResult = {
    snapshotId: string;
    computedAt: string;
    ruleVersions: { filters: string; score: string; selection: string; reasons: string };
    level: Level;
    risk: Risk;
    picks: Pick[];
    referenceCards: SignalSet[];        // gold and bond yields: shown beside the list, not ranked
    rejected: Array<{ symbol: string; failed: FilterCheck[] }>;
    candidates: number;
    locale?: 'en' | 'fr';               // the language the sentences were written in (absent: English)
};

// ---------------------------------------------------------------- logs (append-only)

// session_reset: a visitor opened a new generation (lib/session/reset.ts); logged under `${sessionId}:session`
// replay_run: a replay or a sensitivity run of the time machine (lib/services/replay.ts), with its replay id(s) and snapshot id
export type DecisionLogKind = 'watchlist_run' | 'pick' | 'user_action' | 'simulated_trade' | 'profile_conflict' | 'profile_change' | 'session_reset' | 'replay_run';

export type DecisionLogEntry = {
    userId: string;
    id: string;               // sort key: ISO time + '#' + random suffix
    at: string;
    kind: DecisionLogKind;
    symbol?: string;
    snapshotId?: string;
    ruleVersions?: Record<string, string>;
    payload: unknown;         // the snapshot, filter results, factor scores, sentence, action, trade ... depending on kind
};

export type AgentStep =
    | 'chat_input' | 'context_built' | 'prompt_built' | 'orchestrator_call' | 'subagent_call' | 'tool_call'
    | 'guardrail_check' | 'action_routed' | 'preview_shown' | 'confirmed' | 'cancelled' | 'applied' | 'result' | 'undo' | 'error';

export type AgentActionLogEntry = {
    userId: string;
    id: string;               // sort key: ISO time + '#' + random suffix
    at: string;
    actionId: string;         // one per agent request; ties every row of the request together
    step: AgentStep;
    actor: string;            // 'web', 'orchestrator', 'subagent:market_data', 'writer' ...
    promptVersion?: string;
    modelId?: string;
    awsRequestId?: string;    // joins to CloudTrail and the Bedrock invocation log
    inputTokens?: number;
    outputTokens?: number;
    promptSha256?: string;
    replySha256?: string;
    dataUsed?: unknown;
    statedReason?: string;
    before?: unknown;
    after?: unknown;
    result?: unknown;
};

// ---------------------------------------------------------------- simulated portfolio and rules

export type SimulatedTrade = {
    id: string;
    at: string;
    symbol: string;
    side: 'buy' | 'sell';     // internal field names only; never shown as advice
    quantity: number;
    price: Sourced;           // fill at the last price, with its source
    currency: string;
    valueCad: number;
    origin: 'card' | 'rule' | 'agent';
    ruleId?: string;
    reason: string;
    reasonRef?: TextRef;      // the reason's catalog key and values, when the app wrote it (not for a reason given as text)
    simulated: true;
};

export type Position = { symbol: string; name: string; quantity: number; avgCostCad: number; sector?: string; assetClass: AssetClass };
export type Portfolio = { cashCad: number; startingCashCad: number; positions: Position[]; trades: SimulatedTrade[] };

export type InvestmentRule = {
    id: string;
    createdAt: string;
    status: 'active' | 'paused';
    text: string;             // the user's own words
    symbol: string;
    trigger: { type: 'price_below' | 'price_above' | 'change_pct_below' | 'change_pct_above'; value: number };
    action: { side: 'buy' | 'sell'; amountCad?: number; quantity?: number };
    once: boolean;
    lastFiredAt?: string;
};

// ---------------------------------------------------------------- agent

export type AgentActionType = 'reply' | 'lookup' | 'layout_change' | 'rule_create' | 'rule_pause' | 'explain_pick' | 'profile_change' | 'simulated_trade';

export type ProposedAction = {
    type: AgentActionType;
    summary: string;          // one plain sentence for the preview
    before?: unknown;
    after?: unknown;
    params: Record<string, unknown>;
    needsConfirm: boolean;
};

export type AgentReply = {
    actionId: string;
    text: string;
    sources: Array<{ label: string; source: string; fetchedAt?: string; asOf?: string }>;
    proposed?: ProposedAction;
    refused?: boolean;
    conflict?: { symbol: string; checks: FilterCheck[] };
};
