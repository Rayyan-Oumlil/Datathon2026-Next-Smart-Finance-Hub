# AlphaForge

A profile-aware stock quotes app with a traceable AI agent, built for a datathon on AI for investment decisions.

**Simulation only.** The app places no real trades and gives no investment advice. Every number shows its source and the time it was fetched, and every suggestion can be traced back to the inputs and rule versions that produced it.

Built on [OpenStock](https://github.com/Open-Dev-Society/OpenStock) by Open Dev Society. Licence: AGPL-3.0, same as the original. See [Licence and credits](#licence-and-credits).

## What it does

- **Onboarding** asks a few questions and computes an experience level (Novice, Intermediate, Expert) and a risk profile (Low, Medium, High) with versioned rules.
- **Smart watchlist** ranks assets for that profile with fixed rules: filters, a four-factor score, a selection step. No model takes part in filtering, scoring or ranking. "Why?" on each card shows the score, every filter check with its actual values, and every input with its source and time.
- **Simulated portfolio** starts with $10,000 CAD of pretend money. Trades are filled at the last price we hold and written to an append-only log; the portfolio is a replay of that log.
- **Investment rules** ("when AAPL is below 150, simulate a purchase of 200 CAD") are checked against live quotes and fill in simulation only.
- **Agent panel** answers questions, explains picks, and proposes changes (layout, rules, profile, simulated trades). It never applies anything itself: each change shows a before/after preview, waits for confirmation and can be undone. When a request conflicts with the user's profile, it names the conflict with the actual values and still lets the user proceed in simulation.

The specification is in [docs/spec.md](docs/spec.md). Every threshold, weight and formula is in [rules/v1.json](rules/v1.json).

## How it is put together

```
Browser
  └─ Web app (Next.js, this repo root)        onboarding, three tabs, agent panel, API routes
       ├─ lib/rules, lib/watchlist            level and risk rules, the watchlist pipeline (pure functions)
       ├─ lib/sources                         Finnhub, TMX Money, Yahoo chart, Bank of Canada, Kraken
       ├─ lib/services                        profile, watchlist, portfolio, rules engine, layout
       ├─ lib/store                           DynamoDB: profile_config, decision_log, agent_action_log
       └─ lib/agent  ──HTTP / AgentCore──►  Agent service (agent/, Python, Strands Agents SDK)
                                               orchestrator (Claude Sonnet 5.5) + seven subagents (Claude Haiku 5.5)
                                               on Amazon Bedrock, with a Bedrock Guardrail
```

The agent service has no calculators of its own. Its tools call the web app's internal API, so a figure is computed in one place only. The contract between the two is in [docs/agent-api.md](docs/agent-api.md).

## Traceability

| What | Where it is recorded |
|---|---|
| Each watchlist run: the whole input snapshot, every candidate's filter results and factor scores, rule versions | `decision_log` (append-only) |
| Each pick, user action, simulated trade and profile conflict | `decision_log` |
| Each agent step: prompt version, data used, stated reason, before/after, result, model id, AWS request id, token counts, hashes of prompt and reply | `agent_action_log` (append-only, written by plain code) |
| Who called which model and when | AWS CloudTrail (trail `datathon-llm-audit`, log file integrity validation on) |
| The prompt and reply text of each model call | Bedrock model invocation logging, in S3 |

The two logs have no update or delete path in the code, and the deployed task's IAM role has no `UpdateItem` or `DeleteItem` on them.

To see one model call on the AWS side, take the `awsRequestId` from the Trace section of a reply in the agent panel and run:

```bash
infra/lookup-call.sh <aws-request-id>
```

CloudTrail lags by about five minutes. It records the call, not the text; the text is in the invocation log.

## Run it locally

Requirements: Node 24 or later, Python 3.11 or later with `uv`, an AWS account with access to Amazon Bedrock in `us-east-1`, and a free Finnhub key.

```bash
cp .env.example .env          # then fill in FINNHUB_API_KEY and INTERNAL_API_TOKEN
npm ci
node scripts/create-tables.mjs            # creates the three DynamoDB tables (AWS, or DynamoDB Local if DYNAMODB_ENDPOINT is set)
node scripts/refresh-signals.mjs          # warms the daily data cache for the whole universe, about 10 minutes
npm run dev
```

Agent service, in a second terminal:

```bash
cd agent
uv venv --python 3.13 && uv pip install -e ".[dev]"
set -a; . ../.env; set +a
WEB_INTERNAL_URL=http://localhost:3000 .venv/bin/python -m app.main
```

Tests:

```bash
npm test                                  # web: rules, pipeline, stores, sources, services, agent router
cd agent && .venv/bin/python -m pytest    # agent service
```

`docker compose up` starts the web app with DynamoDB Local; run `DYNAMODB_ENDPOINT=http://localhost:8000 node scripts/create-tables.mjs` after each start, because that database is in memory.

A new value of `DEMO_USER_ID` starts a fresh demo user with an empty simulated portfolio and history.

## Deploy to AWS

All in `us-east-1`. Scripts are in [infra/](infra/):

| Script | Does |
|---|---|
| `infra/audit.sh` | CloudTrail trail with data events for Guardrail, Knowledge Base and AgentCore; Bedrock invocation logging to S3; the Guardrail in `infra/guardrail.json` |
| `infra/ecs-base.sh` | one-time: secret, IAM roles, security groups, load balancer |
| `infra/deploy-web.sh` | builds the web image, pushes to ECR, deploys the ECS Fargate service |
| `infra/deploy-agent.sh` | builds the agent image (arm64), pushes to ECR, updates the AgentCore runtime |
| `infra/lookup-call.sh` | finds one model call in CloudTrail and in the invocation log by request id |

The web app runs on ECS Fargate behind an Application Load Balancer. The agent service runs on Amazon Bedrock AgentCore Runtime.

## Data sources and their limits

Details, endpoints and terms of use are in [docs/data-sources.md](docs/data-sources.md). In short:

- Bank of Canada (bond yields, USD/CAD) is open and licensed for reuse with attribution.
- Finnhub (US quotes and fundamentals), TMX Money (Canadian quotes and daily closes) and Kraken (crypto) work without a paid plan, but their terms allow personal or non-commercial use only. This is a non-commercial demo; a real product would license market data.
- Yahoo's chart endpoint is unofficial and often refuses automated calls. It is used only as a fallback and labelled as unofficial.
- The ESG tag on cards is demo data set by hand. It is not real ESG data and says nothing about the real company.
- No free, licensed source of TSX quotes or price history was found.

## Known limits

- The rule values in `rules/v1.json` are untested first values.
- A Bedrock Knowledge Base could not be created on the workshop account (the action is denied), so the glossary is served from the vetted files in `agent/glossary/`, quoted and cited the same way. Setting `KNOWLEDGE_BASE_ID` switches to a Knowledge Base.
- The Guardrail blocks the forbidden words and ungrounded replies. Its "investment advice" topic and relevance check only detect and log, because they refused correct factual replies when set to block.
- Gold has no price: the only free source found (Yahoo futures) refused the calls.
- Canadian stocks have no revenue-growth figure and no news count; the universe has no Canadian health-care names.
- Saved layout and investment rules live in a file inside the web container and are lost when the task restarts. The profile, the logs and therefore the portfolio are in DynamoDB and persist.
- The interface is in English only. Privacy consent and legal disclaimers have not had a legal review.
- The site has no sign-in and no rate limit on the agent route.

## Licence and credits

This project is a modified version of [OpenStock](https://github.com/Open-Dev-Society/OpenStock) by Open Dev Society and its contributors, and is distributed under the same licence, the GNU Affero General Public License v3.0 ([LICENSE](LICENSE)). The Finnhub and Yahoo data code, the quotes route, the TradingView widgets, the stock page and the search come from OpenStock. Sign-in, background jobs, email, the marketing site and MongoDB were removed.

Under the AGPL, anyone who runs a modified version as a network service must offer its source to its users under the same licence.

Company lists come from Wikipedia ("List of S&P 500 companies", "S&P/TSX 60"), used under CC BY-SA 4.0. Charts are TradingView widgets.
