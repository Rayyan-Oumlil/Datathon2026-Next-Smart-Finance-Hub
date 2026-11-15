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

Response (`AgentReply` plus a trace):

```json
{
  "actionId": "act_…",
  "text": "…",
  "sources": [{ "label": "AAPL price", "source": "Finnhub", "fetchedAt": "…", "asOf": "…" }],
  "proposed": { "type": "rule_create", "summary": "…", "params": { … }, "needsConfirm": true },   // optional
  "conflict": { "symbol": "TSLA", "checks": [ … FilterCheck … ] },                                 // optional
  "refused": false,
  "promptVersion": "p1",
  "modelCalls": [{ "actor": "orchestrator", "modelId": "…", "awsRequestId": "…", "inputTokens": 0, "outputTokens": 0 }]
}
```

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
| `/api/internal/tools/conflict-check` | `{ symbol }` | `{ symbol, conflicts: FilterCheck[], signals: SignalSet, level, risk }` | orchestrator |
| `/api/internal/tools/validate-rule` | `{ rule: { text, symbol, trigger, action, once } }` | `{ ok: boolean, rule?: InvestmentRule, errors?: string[], currentPrice?: Sourced }` | Rules |
| `/api/internal/tools/rules` | `{}` | `{ rules: InvestmentRule[] }` | Rules |
| `/api/internal/tools/layout` | `{}` | `{ current: string[], library: [{ id, title, fixed: boolean, minLevel? }] }` | Layout |
| `/api/internal/tools/profile-preview` | `{ changes }` | `{ before: { level, risk }, after: { level, risk }, levelResult, riskResult }` | Profile |

The glossary is read by the agent service itself: from the Bedrock Knowledge Base when `KNOWLEDGE_BASE_ID` is set, otherwise from the markdown files in `agent/glossary/`. Either way the answer quotes the document and cites its location.

## 3. Agent action log

Both sides write rows of type `AgentActionLogEntry` to the `agent_action_log` table, with the same `actionId`. The writer is plain code on both sides; the model never writes a row.

- Web app writes: `chat_input`, `context_built`, `action_routed`, `preview_shown`, `confirmed`, `cancelled`, `applied`, `result`, `undo`.
- Agent service writes: `prompt_built`, `orchestrator_call`, `subagent_call`, `tool_call`, `guardrail_check`, `error`.

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
