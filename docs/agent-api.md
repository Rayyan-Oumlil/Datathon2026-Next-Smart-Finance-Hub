# Agent service ↔ web app contract

Two processes: the web app (Next.js, TypeScript) and the agent service (`/agent`, Python, Strands Agents SDK). All calculators live in the web app, so a number is computed in one place only. The agent service calls them over HTTP and never computes a figure itself.

Shared types are in `lib/domain/types.ts`. JSON field names below are those types' field names.

## 1. Web app → agent service

`POST {AGENT_URL}/invocations` locally (default `http://localhost:8080`), or `InvokeAgentRuntime` on AgentCore when `AGENT_RUNTIME_ARN` is set. Same payload, same response.

Request:

```json
{
  "actionId": "act_…",            // created by the web app, one per user request
  "userId": "demo-user",
  "message": "why is ENB on my list?",
  "history": [{ "role": "user" | "assistant", "text": "…" }],   // last turns, at most 10
  "context": {
    "locale": "en" | "fr",          // the reply language: the app's language for this request
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

`context.locale` is the language of the request, read by the web app with `getAppLocale()` (the saved language cookie, else the browser's `Accept-Language`, else English). The agent service answers in that language: every prompt carries the instruction (for French: Canadian French as used by Québec financial institutions, plain and factual, vouvoiement, figures written the French way such as `35,0 %` and `1 500,00 $`). Any other value is refused as `invalid_request`; a missing one means English. The fixed texts follow the locale on both sides: the agent service's safe refusal and its neutral proposal sentence, and on the web side the neutral sentence that replaces a withheld reply, the notices, the preview summaries, rows and facts, the confirm and undo messages, the error and rate-limit messages, and the `detail` of each `conflict.checks[]` entry (the agent passes the locale to `conflict-check`). Source names (`sources[].source`, `preview.facts[].source`) are provider names stored as plain strings, such as `TMX Money (delayed 15 min or more)`, and stay as given; only the app's own labels follow the locale (the preview's `derived`, and `demo data` and `derived` as the panel shows them).

Word checks (agent service, then the web app's last check), on every reply whatever its language: the English never-words (`rules/v1.json` `reasons.never_words`), the French never-words (`reasons.never_words_fr`; until the file holds that key, the list in `agent/app/config.py` and `lib/agent/wording.ts`), and the English and French judgement and prediction words (`agent/app/checks.py`, mirrored in `lib/agent/wording.ts` and kept in step by a test). Whole words, any letter case, accents significant (`sur` is not `sûr`), text compared in Unicode NFC form. Quoted data that is exempt: the exact name of a company or asset (2 to 6 words, at most 60 characters) found in the request's tool results or the context (agent service) or in the app's asset list or the watchlist picks (web app); the user's message and history never count. A long "name" is still checked word by word. An exact sentence of the vetted glossary is exempt from the judgement words only (no glossary file holds a listed word today), and a few fixed phrases hold a listed word without advising: `best bid`, `best ask`, `meilleur cours acheteur`, `meilleur cours vendeur`, `bien sûr`, `bon(s) du Trésor`, `bon(s) de souscription`.

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

`/api/agent` (the web app's own route) accepts 10 requests a minute for the demo user, since each one costs several model calls. Over the limit it answers `429` with `{ "error": "Too many requests. Wait a minute and try again." }` (in French: `"Trop de demandes. Attendez une minute, puis réessayez."`).

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

## 2. Agent service → web app (tools)

Base URL `WEB_INTERNAL_URL` (default `http://localhost:3000`). Every call sends `x-internal-token: $INTERNAL_API_TOKEN` and `x-action-id`. All are `POST` with a JSON body containing `userId`. Every number in a response is a `Sourced` object.

| Endpoint | Body | Returns | Used by subagent |
|---|---|---|---|
| `/api/internal/tools/market-data` | `{ symbols: string[] }` (also `GOLD`, `BTC`, `ETH`, `CA2Y`, `CA5Y`, `CA10Y`) | `{ items: SignalSet[] }` | Market data |
| `/api/internal/tools/explain-pick` | `{ symbol }` | `{ listed: boolean, pick?: Pick, rejected?: FilterCheck[], snapshotId, computedAt, ruleVersions }` from the decision log | Watchlist explainer |
| `/api/internal/tools/portfolio` | `{}` | `{ portfolio: Portfolio, valueCad: Sourced, positions: [{ …Position, price: Sourced, valueCad, returnPct }], bySector, simulated: true }` | Portfolio |
| `/api/internal/tools/portfolio-stats` | `{ metric: "return" | "drawdown" | "correlation", symbols?: string[], period: "1m" | "3m" | "1y" }` | `{ metric, period, result, method, sources: Sourced[] }` | Portfolio |
| `/api/internal/tools/portfolio-xray` | `{ change?: { symbol, amountCad: number > 0, direction: "add" \| "reduce" }, locale?: "en" \| "fr" }` | Without `change`: the X-ray (`version: "xray-v1"`, `holdings`, `concentration`, `windows: { full, last3y, last1y }` each `{ available: false, reason }` or `{ available: true, from, to, observations, coverage, volatilityPct, maxDrawdown, worstDay, worstSpan20, diversificationRatio, risk[], pairs[] }` without the chart curve, `band`, `dropAnswer`, `noHistory`, `unpriced`, `method`, `assumptions`, `sources: Sourced[]`, and `figures`: every headline figure repeated as a `Sourced` value, keyed with its window (`volatility_last1y`, `riskShare_full`...), so a reply that states one can cite its source). With `change`: `{ change, before, after, conflicts: FilterCheck[], simulated: true }`. Read-only; a refusal is `200 { error }` | Portfolio |
| `/api/internal/tools/conflict-check` | `{ symbol, locale?: "en" \| "fr" }` | `{ symbol, conflicts: FilterCheck[] (each `detail` in the given language, English when left out; `textRef` renders it in either), sources: { volatility1y?, marketCapUsd?, avgDailyTradedValueUsd?, fxUsdCad?: Sourced }, level, risk }` (only the values behind the conflicts; the full signal set stays in the decision log) | orchestrator |
| `/api/internal/tools/validate-rule` | `{ rule: { text, symbol, trigger, action, once } }` | `{ ok: boolean, rule?: InvestmentRule, errors?: string[], currentPrice?: Sourced }` | Rules |
| `/api/internal/tools/rules` | `{}` | `{ rules: InvestmentRule[] }` | Rules |
| `/api/internal/tools/layout` | `{ locale?: "en" \| "fr" }` | `{ current: string[], library: [{ id, title, fixed: boolean, minLevel? }] }`, titles in the given language as the Portfolio tab shows them | Layout |
| `/api/internal/tools/profile-preview` | `{ changes }` | `{ before: { level, risk }, after: { level, risk }, levelResult, riskResult }` | Profile |

The orchestrator holds no data tools. Its `check_profile_conflict` tool calls `conflict-check` and gives the model only `{ symbol, conflicts, level, risk }`; each conflict keeps its `detail` text, `value` and `limit`. The tool sends the request's `context.locale` as `locale`, so the details the model reads and the reply's `conflict.checks[].detail` are in the reply's language. The full response, `sources` included, is kept in plain code so the reply's `sources` list still cites the source and time of each conflict's value.

Only the tool results of the request and the `context` the web app built count as grounding for a figure, in the numbers check and in the Bedrock Guardrail's grounding source. The client-supplied `history` and `message` do not.

The layout library holds only the modules the Portfolio tab draws from the saved layout: `total_value` (fixed), `performance`, `holdings`, `sector_allocation`, `investment_rules`. A saved layout that still holds an id no longer in the library is cleaned on read.

The glossary is read by the agent service itself, in the request's language. English: from the Bedrock Knowledge Base when `KNOWLEDGE_BASE_ID` is set, otherwise from the markdown files in `agent/glossary/`. French: always from `agent/glossary/fr/` (the same 13 file names and facts; the Knowledge Base holds the English files only). Either way the answer quotes the document and cites its location, for example `agent/glossary/fr/etf.md`, and the source label reads `Glossaire : …` in French. Source labels of figures follow the locale too (`TSLA volatilité sur 1 an`).

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
