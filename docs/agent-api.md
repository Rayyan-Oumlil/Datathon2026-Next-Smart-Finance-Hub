# Agent service ↔ web app contract

Two processes: the web app (Next.js, TypeScript) and the agent service (`/agent`, Python, Strands Agents SDK). All calculators live in the web app, so a number is computed in one place only. The agent service calls them over HTTP and never computes a figure itself.

Shared types are in `lib/domain/types.ts`. JSON field names below are those types' field names.

## 1. Web app → agent service

`POST {AGENT_URL}/invocations` locally (default `http://localhost:8080`), or `InvokeAgentRuntime` on AgentCore when `AGENT_RUNTIME_ARN` is set. Same payload, same response.

Request:

```json
{
  "actionId": "act_…",            // created by the web app, one per user request
  "userId": "3f0c…-uuid:p0:f0",
  "message": "why is ENB on my list?",
  "history": [{ "role": "user" | "assistant", "text": "…" }],   // last turns, at most 10; used only when memory is off or fails
  "conversationId": "…",          // optional, 1 to 100 characters: the panel's conversation, the memory session
  "context": {
    "locale": "en" | "fr",          // the reply language: the language of the message (see below)
    "level": "Novice" | "Intermediate" | "Expert",
    "risk": "Low" | "Medium" | "High",
    "agentStyle": "teach me" | "suggest" | "just the data",
    "profile": { … ProfileConfig.answers … },
    "holdings": [{ "symbol": "AAPL", "quantity": 3, "sector": "Information Technology" }],
    "watchlist": [{ "rank": 1, "symbol": "NVDA", "name": "…", "total": 86.0 }],
    "layout": ["total_value", "performance", "holdings", "…"]
  }
}
```

Only data we hold goes into `context`. Adanos sentiment and raw news text never do.

`context.page` (optional) is the page the user is looking at: `{ name: "portfolio" | "xray" | "overview" | "profile" | "stock", symbol?, xrayWindow?: "full" | "last3y" | "last1y" }`. The browser sends a path and, on the X-ray page, the period on screen; the web app turns it into one of those names (`lib/agent/page.ts`) and never forwards the browser's own text. The orchestrator reads it to resolve "this", "here" and "this X-ray", and the portfolio specialist gets it in its context slice. A missing or unknown page leaves `context` as it was. A page can also ask the agent a ready-made question (the X-ray page's "Explain this X-ray" button): the panel opens and sends it as if typed.


`context.locale` is the language of the reply, which is the language of the message, typed or dictated: a question in French gets a French answer and one in English an English answer, whatever the app is set to, and the language can change from one message to the next. The web app reads it with `replyLanguage()` (`lib/agent/language.ts`), plain code with no model: it counts French and English function words, accented letters and French elisions (`l'`, `qu'`), and ignores tickers such as `XIU.TO`. A message with no language of its own (`TSLA`, `ok`) takes the language of the most recent earlier turn that has one, else the app's language, which `getAppLocale()` reads (the saved language cookie, else the browser's `Accept-Language`, else English). The `context_built` row of the action log records `locale`, `localeBasis` (`message`, `conversation` or `app`) and `appLocale`, so a reply's language can be traced. The chat reply carries `language`, and the panel passes it back on confirm, undo and text-to-speech so those follow the conversation too; the panel's own labels stay in the app's language. The agent service answers in that language: every prompt carries the instruction (for French: Canadian French as used by Québec financial institutions, plain and factual, vouvoiement, figures written the French way such as `35,0 %` and `1 500,00 $`). Any other value is refused as `invalid_request`; a missing one means English. The fixed texts follow the locale on both sides: the agent service's safe refusal and its neutral proposal sentence, and on the web side the neutral sentence that replaces a withheld reply, the notices, the preview summaries, rows and facts, the confirm and undo messages, the error and rate-limit messages, and the `detail` of each `conflict.checks[]` entry (the agent passes the locale to `conflict-check`). Source names (`sources[].source`, `preview.facts[].source`) are provider names stored as plain strings, such as `TMX Money (delayed 15 min or more)`, and stay as given; only the app's own labels follow the locale (the preview's `derived`, and `demo data` and `derived` as the panel shows them).

Word checks (agent service, then the web app's last check), on every reply whatever its language: the English never-words (`rules/v1.json` `reasons.never_words`), the French never-words (`reasons.never_words_fr`; until the file holds that key, the list in `agent/app/config.py` and `lib/agent/wording.ts`), and the English and French judgement and prediction words (`agent/app/checks.py`, mirrored in `lib/agent/wording.ts` and kept in step by a test). Whole words, any letter case, accents significant (`sur` is not `sûr`), text compared in Unicode NFC form. Quoted data that is exempt: the exact name of a company or asset (2 to 6 words, at most 60 characters) found in the request's tool results or the context (agent service) or in the app's asset list or the watchlist picks (web app); the user's message and history never count. A long "name" is still checked word by word. The app's own widget titles (the layout tool's `title`, both languages on the web side) are exempt the same way. For a reply that goes with a proposed settings change (`layout_change`, `rule_create`, `rule_pause`, `strategy_propose`, `profile_change`), the names the user gave (the strategy's `name`, the rule's own `text`) and short quotes of the user's own message (between « », “ ”, " " or ' ', 2 to 6 words, at most 60 characters, found word for word in the message) are exempt too.

Settings replies. A reply that goes with one of those proposals is a short sentence about a change: there is no market figure to ground. The agent service then checks its wording only: the grounded-numbers and conflicts-named checks are skipped, and ApplyGuardrail is called without a grounding source or query (no contextual grounding check; a grounding, relevance or word-filter block is only reported, since our own word lists already passed it with the exemptions above; the denied topic, content and personal-data policies still block). A reply that proposes nothing and was built only from the settings tools (`layout`, `rules`, `validate-rule`, `profile-preview`, optionally `conflict-check`), such as a question back or why a rule cannot be created, skips only the contextual grounding check. Every other reply, any reply that used market data and every answer to "what do you think of X", gets every check. The `guardrail_check` row records `replyKind` (`setting`, `settings_talk` or `data`) and the exempt quotes. The preview, Confirm and Undo stay for every change. An exact sentence of the vetted glossary is exempt from the judgement words only (no glossary file holds a listed word today), and a few fixed phrases hold a listed word without advising: `best bid`, `best ask`, `meilleur cours acheteur`, `meilleur cours vendeur`, `bien sûr`, `bon(s) du Trésor`, `bon(s) de souscription`.

The numbers check reads a French reply's figures the French way: `58,4 %`, `251,30 $ US` and `1 500,00 $` (regular, no-break or narrow no-break space) are the values 58.4, 251.30 and 1500; a decimal point is accepted too. Numbers inside the data's own strings are read in both ways.

Response (`AgentReply` plus a trace):

```json
{
  "actionId": "act_…",
  "text": "…",
  "sources": [{ "label": "AAPL price", "source": "Finnhub", "fetchedAt": "…", "asOf": "…" }],
  "proposed": { "type": "rule_create", "summary": "…", "params": { … }, "needsConfirm": true },   // optional
  "conflict": { "symbol": "TSLA", "checks": [ … FilterCheck … ] },                                 // optional
  "refused": false,
  "promptVersion": "p4",
  "modelCalls": [{ "actor": "orchestrator", "modelId": "…", "awsRequestId": "…", "inputTokens": 0, "outputTokens": 0 }],
  "logComplete": true
}
```

`logComplete` is `false` when a row of this request could not be written to the agent action log, even after one retry. The reply is still returned (the demo stays available) and the later rows are still tried; the errors are in `trace.logErrors`. The web app passes `logComplete` on in its `/api/agent` response and records it as `agentLogComplete` in its own `result` row.

`/api/agent` (the web app's own route) accepts 10 requests a minute per visitor session (and 30 per address), since each one costs several model calls. Over the limit it answers `429` with `{ "error": "Too many requests. Wait a minute and try again." }` (in French: `"Trop de demandes. Attendez une minute, puis réessayez."`).

The agent service never applies anything. `proposed` is a request; the web app's action router checks it against the whitelist, shows a before/after preview, and applies it only after the user confirms.

Proposed action types and their `params`:

| type | params | confirm |
|---|---|---|
| `reply` | — | no |
| `lookup` | `{ symbols: string[] }` | no |
| `explain_pick` | `{ symbol }` | no |
| `layout_change` | `{ layout: string[] }` (the full new order of widget ids) | yes |
| `rule_create` | `{ rule: InvestmentRule without id/createdAt }` | yes |
| `rule_pause` | `{ ruleId, status: "paused" | "active" }` | yes |
| `profile_change` | `{ changes: { level?, risk?, sectors?, … } }` | yes |
| `simulated_trade` | `{ symbol, side, amountCad? , quantity? }` | yes |
| `strategy_propose` | `{ strategy: StrategyInput ({ name, rules }), replaceId? }` | yes |

`strategy_propose` (lib/agent/strategy-propose.ts). The strategy is checked by the strict schema of `lib/strategy` (`parseStrategy`): an unknown field or a value out of its range is refused; the refusal is shown in the reply's language (the issues' own sentences) and the action log keeps the issue codes (`code@path`). The agent service checks the same schema first through `/api/internal/tools/strategies` (`validate`), so a refused strategy comes back to the model with its codes and is corrected once (a second refusal is final). The preview (`preview.strategy`) holds the rules as sentences (lib/agent/strategy-words.ts, in the request's language), a 5-year history preview computed by `runReplay` on the visitor's current simulated portfolio from 2021-01-04 (final value, total return, largest fall and volatility, without rules and with the strategy; how many times each rule fired; replay id and snapshot id), the profile conflicts with their actual values (lib/agent/strategy-conflict.ts, below) and the label « Rejeu illustratif sur données historiques. Ce n'est pas une prédiction. ». Apply = `saveStrategy` (`replaceId` updates the stored strategy, its version goes up); the result carries `strategy` and `timeMachine: /time-machine?strategy=<id>`. Undo restores the replaced version, or moves a new strategy from `strategies` to `strategiesRemoved` in the visitor's app-state document; no log row is deleted (`user_action` rows `strategy_remove` / `strategy_restore`). The single `rule_create` action is unchanged.

Profile conflicts of a strategy (lib/agent/strategy-conflict.ts, deterministic): every symbol a rule could acquire (allocation targets new to the portfolio or above their current weight by more than 0.5 point, the drawdown guard's defensive symbol, the weight cap's proceeds symbol, a price threshold that adds) goes through the per-asset profile-conflict check (lib/watchlist/conflict.ts). Two strategy-level notes: more than 10 % of an allocation target's weights in assets whose 1-year volatility is above the profile's volatility cap (this app's threshold, `HIGH_VOL_SHARE_MAX_PCT`), and crypto in a profile other than High. Conflicts never block: the user may confirm in simulation. A preview with conflicts logs a `profile_conflict` decision (`proceeded: false`, `context: "strategy_propose"`), and a confirmation logs another (`proceeded: true`).

`context.strategies` (left out when there is none): the visitor's stored strategies as `{ id, name, version, rules, kinds: { <rule kind>: count } }`. `context.page.name` may also be `strategy` (`/strategy`) or `time_machine` (`/time-machine`).

### Streaming

With `"stream": true` in the request the agent service answers `text/event-stream` (AgentCore does this when the entrypoint returns a generator): one JSON object per `data:` line. Without the flag the reply is the single JSON body above.

| `type` | Fields | Meaning |
|---|---|---|
| `stage` | `stage` (`orchestrator`, `subagent`, `tool`, `guardrail`, `retry`), `state` (`start`, `done`), `name?`, `ok?`, `ms?`, `attempt?`, `passed?` | a step began or ended; names and timings only, never arguments or text |
| `heartbeat` | none | sent every 10 s while quiet, so a load balancer does not drop the connection |
| `final` | `reply` (the response body above) | always last on success |
| `error` | `message` | an unexpected failure; the stream ends |

The web app's `POST /api/agent/stream` takes the same body as `/api/agent`, runs the same pipeline, forwards `stage` events, and sends `final` only after the word check, the router and the log rows are done; it sends `error` with `status` and `message` for a failure after the stream started. A bad or rate-limited request is answered as JSON before the stream starts. Text that fails a check is never sent. Models still use Converse, so the audit rows are unchanged.

## 2. Agent service → web app (tools)

Base URL `WEB_INTERNAL_URL` (default `http://localhost:3000`). Every call sends `x-internal-token: $INTERNAL_API_TOKEN` and `x-action-id`. All are `POST` with a JSON body containing `userId`: the scope id `<sessionId>:p<n>:f<m>` the agent received (lib/session/scope.ts). Only the current generation of an existing session is accepted; an old one is refused. Every number in a response is a `Sourced` object.

| Endpoint | Body | Returns | Used by subagent |
|---|---|---|---|
| `/api/internal/tools/market-data` | `{ symbols: string[] }` (also `GOLD`, `BTC`, `ETH`, `CA2Y`, `CA5Y`, `CA10Y`) | `{ items: SignalSet[] }` | Market data |
| `/api/internal/tools/explain-pick` | `{ symbol }` | `{ listed: boolean, pick?: Pick, rejected?: FilterCheck[], snapshotId, computedAt, ruleVersions }` from the decision log | Watchlist explainer |
| `/api/internal/tools/portfolio` | `{}` | `{ portfolio: Portfolio, valueCad: Sourced, positions: [{ …Position, price: Sourced, valueCad, returnPct }], bySector, simulated: true }` | Portfolio |
| `/api/internal/tools/portfolio-stats` | `{ metric: "return" | "drawdown" | "correlation", symbols?: string[], period: "1m" | "3m" | "1y" }` | `{ metric, period, result, method, sources: Sourced[] }` | Portfolio |
| `/api/internal/tools/portfolio-xray` | `{ change?: { symbol, amountCad: number > 0, direction: "add" \| "reduce" }, locale?: "en" \| "fr", window?: "full" \| "last3y" \| "last1y" (default "full") }` | Without `change`: the X-ray (`version: "xray-v1"`, `holdings`, `concentration`, `windows: { <the window asked for> }` (one window only, since the model's report is limited), each `{ available: false, reason }` or `{ available: true, from, to, observations, coverage, volatilityPct, maxDrawdown, worstDay, worstSpan20, diversificationRatio, risk[], pairs[] }` without the chart curve, `band`, `dropAnswer`, `noHistory`, `unpriced`, `method`, `assumptions`, `sources: Sourced[]`, and `figures`: every headline figure repeated as a `Sourced` value, keyed with its window (`volatility_last1y`, `riskShare_full`...), so a reply that states one can cite its source). With `change`: `{ change, before, after, conflicts: FilterCheck[], simulated: true }`. Read-only; a refusal is `200 { error }` | Portfolio |
| `/api/internal/tools/conflict-check` | `{ symbol, locale?: "en" \| "fr" }` | `{ symbol, conflicts: FilterCheck[] (each `detail` in the given language, English when left out; `textRef` renders it in either), sources: { volatility1y?, marketCapUsd?, avgDailyTradedValueUsd?, fxUsdCad?: Sourced }, level, risk }` (only the values behind the conflicts; the full signal set stays in the decision log) | orchestrator |
| `/api/internal/tools/validate-rule` | `{ rule: { text, symbol, trigger, action, once } }` | `{ ok: boolean, rule?: InvestmentRule, errors?: string[], currentPrice?: Sourced }` | Rules |
| `/api/internal/tools/rules` | `{}` | `{ rules: InvestmentRule[] }` | Rules |
| `/api/internal/tools/strategies` | `{ locale?, makeRoomFor?: { symbol, weightPct }, validate?: StrategyInput }` | `{ strategies: [{ id, name, version, updatedAt, rules, sentences }], currentWeights: [{ symbol, weightPct }], portfolioValueCad, targetsWithRoom? (current weights scaled down by the app so `symbol` takes `weightPct`), validation? ({ ok: true, strategy, sentences } or { ok: false, errors, issues: [{ code, path, values }] }) }`. Read-only | Strategy |
| `/api/internal/tools/replay` | `{ portfolio?: "current" \| [{ symbol, weightPct }] \| "amira" \| "mateo" \| "robert", strategy?: StrategyInput \| strategyId \| null, startDate? (default 2021-01-04), feePerOrderCad? (default 0), locale? }` | `replayDigest(result, locale)` (lib/services/replay.ts) plus `replayId`, `portfolio`, `capitalCad` and a `note`; `worstFall*` fields are renamed `largestFall*` and `worstDay` `largestDailyFall` so the reply never echoes a judgement word; `summary.endedHigher` is left out (no winner). A refused strategy is `200 { error, issues }`. The run is logged (`replay_run`) | Strategy |
| `/api/internal/tools/layout` | `{ locale?: "en" \| "fr" }` | `{ current: string[], hidden: string[], library: [{ id, title, tab: "portfolio" \| "overview", fixed: boolean }] }`, titles in the given language as the pages show them. No widget is gated by level | Layout |
| `/api/internal/tools/profile-preview` | `{ changes }` | `{ before: { level, risk }, after: { level, risk }, levelResult, riskResult }` | Profile |

The strategy subagent (Haiku, `agent/app/prompts/strategy.md`) owns `list_strategies`, `validate_strategy`, `run_replay`, `validate_rule` and `list_rules`. The replay informs, it never recommends: the prompts say the agent explains only from the digest's figures, states both series even when the strategy ended lower, names no winner, and labels it an illustrative replay on historical data, not a prediction. The digest's figures are tool results, so the numbers check counts them as grounded. When a user adds a hyped, volatile stock (TSLA, NVDA...), the reply speaks in risk figures (volatility against the cap from the conflict check, largest fall without and with from the digest), never in past return without the survivorship-bias label.

The orchestrator holds no data tools. Its `check_profile_conflict` tool calls `conflict-check` and gives the model only `{ symbol, conflicts, level, risk }`; each conflict keeps its `detail` text, `value` and `limit`. The tool sends the request's `context.locale` as `locale`, so the details the model reads and the reply's `conflict.checks[].detail` are in the reply's language. The full response, `sources` included, is kept in plain code so the reply's `sources` list still cites the source and time of each conflict's value.

Only the tool results of the request and the `context` the web app built count as grounding for a figure, in the numbers check and in the Bedrock Guardrail's grounding source. The client-supplied `history` and `message` do not.

The layout library holds the modules the Portfolio tab draws from the saved layout (`total_value` (fixed), `performance`, `holdings`, `sector_allocation`, `xray`, `investment_rules`) and the panels of the Overview tab (`overview_*`, shown when listed, hidden when left out). Every widget and every customization is available at every level; the level only picks the layout a new user starts with (`defaultLayout`: a Novice starts without `sector_allocation` and `investment_rules`). A saved layout that still holds an id no longer in the library is cleaned on read.

The glossary is read by the agent service itself, in the request's language. English: from the Bedrock Knowledge Base when `KNOWLEDGE_BASE_ID` is set, otherwise from the markdown files in `agent/glossary/`. French: always from `agent/glossary/fr/` (the same 13 file names and facts; the Knowledge Base holds the English files only). Either way the answer quotes the document and cites its location, for example `agent/glossary/fr/etf.md`, and the source label reads `Glossaire : …` in French. Source labels of figures follow the locale too (`TSLA volatilité sur 1 an`).

### Memory (Amazon Bedrock AgentCore Memory)

When `MEMORY_ID` is set on the agent service (the memory made once by `infra/agent-memory.sh`), each request:

- loads the last 5 turns of its conversation from AgentCore Memory (`ListEvents`) and gives them to the orchestrator in place of the request's `history`; when `MEMORY_ID` is unset or the call fails, the request's `history` is used, so memory never breaks a reply;
- after its checks, stores one event (`CreateEvent`) with two conversational messages: the user's message (`USER`) and the reply the user was shown (`ASSISTANT`), which is the checked reply or the fixed safe refusal. Nothing else is stored: no tool results, figures fetched for the reply, context, prompts or proposals.

Actor: the request's `userId` (the visitor's scope id). Session: a hash of `userId` and `conversationId`, so a new conversation in the panel, and a reset of the profile (a new scope id), start a new memory session. Events expire after 30 days. The memory also has a built-in user-preference strategy (namespace `/users/{actorId}/preferences`); the agent reads up to 3 records into `context.rememberedPreferences` only when `MEMORY_PREFERENCES=1`. The response's `trace` carries `history` (`memory` or `request`) and `memorySaved`.

The runtime role needs `bedrock-agentcore:CreateEvent` and `bedrock-agentcore:ListEvents` on the memory's ARN (and `bedrock-agentcore:RetrieveMemoryRecords` for preferences). Running `infra/agent-memory.sh` needs `bedrock-agentcore:CreateMemory`, `GetMemory` and `ListMemories`.

## 3. Agent action log

Both sides write rows of type `AgentActionLogEntry` to the `agent_action_log` table, with the same `actionId`. The writer is plain code on both sides; the model never writes a row.

- Web app writes: `chat_input`, `context_built`, `action_routed`, `preview_shown`, `confirmed`, `cancelled`, `applied`, `result`, `undo`.
- Agent service writes: `prompt_built`, `orchestrator_call`, `subagent_call`, `tool_call`, `guardrail_check`, `error`.

The `context_built` row (web) and the `prompt_built` row (agent service) record the locale. Log rows stay in English: they are for auditors, not shown to the user.

Each model call row carries `modelId`, `awsRequestId`, token counts, and SHA-256 hashes of the prompt and of the reply. The same `actionId` is sent to Bedrock as request metadata, so the row can be matched to the CloudTrail event (by `awsRequestId`) and to the invocation log (by `awsRequestId` or `actionId`).

## 4. Environment

| Variable | Used by | Meaning |
|---|---|---|
| `AGENT_URL` | web | agent service base URL for local runs |
| `AGENT_RUNTIME_ARN` | web | AgentCore runtime ARN; when set, the web app calls AgentCore instead of `AGENT_URL` |
| `WEB_INTERNAL_URL` | agent | web app base URL |
| `INTERNAL_API_TOKEN` | both | shared secret for `/api/internal/*` |
| `AWS_REGION` | both | `us-east-1` |
| `ORCHESTRATOR_MODEL_ID` | agent | default `us.anthropic.claude-sonnet-5-5` |
| `SUBAGENT_MODEL_ID` | agent | default `us.anthropic.claude-haiku-5-5` |
| `GUARDRAIL_ID`, `GUARDRAIL_VERSION` | agent | Bedrock Guardrail applied to every reply |
| `KNOWLEDGE_BASE_ID` | agent | optional; glossary Knowledge Base |
| `AGENT_ACTION_LOG_TABLE` | both | default `agent_action_log` |
| `AGENT_REPLY_CACHE` | web | `off` turns off the glossary reply cache (below) |
| `MEMORY_ID` | agent | optional; AgentCore Memory id from `infra/agent-memory.sh`. Unset: no memory, the request's history is used |
| `MEMORY_PREFERENCES` | agent | optional; `1` reads remembered user preferences into the context |

### Reply cache

A question asked on its own (no history) and answered before, in the same language, level, risk and style, is answered again from the first reply when that reply was made only of glossary sources (`agent/glossary/…`): no proposal, no conflict, nothing refused, nothing withheld. Every figure-bearing reply goes to the agent as before. Entries live one hour in the web server's memory (a restart or a second container starts empty). The stored reply still goes through the web app's wording check, the request leaves its own `chat_input`, `context_built` and `result` rows, and the `result` row carries `cache: { hit: true, fromActionId }` so an auditor can follow it to the original model calls. The stream reports it as a `cache` stage.
