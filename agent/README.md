# Agent service

Python service behind the web app's agent panel. An orchestrator (Claude Sonnet 5.5) hands tasks to seven
subagents (Claude Haiku 5.5); the subagents call the web app's calculators over HTTP. The service explains
data and proposes actions. It never computes a figure, never applies an action and never gives investment advice.

Contract with the web app: [`docs/agent-api.md`](../docs/agent-api.md). Behaviour: [`docs/spec.md`](../docs/spec.md) section 9.

## Layout

| File | What it does |
|---|---|
| `app/main.py` | Entrypoint (`BedrockAgentCoreApp`): `POST /invocations`, `GET /ping`, port 8080. Request check, guardrail loop, response |
| `app/orchestrator.py` | The orchestrator agent and its two control tools: `check_profile_conflict`, `propose_action` |
| `app/subagents.py` | The seven subagents, each with only its own tools and its slice of the context |
| `app/web_tools.py` | HTTP clients for `/api/internal/tools/*`; they return the web app's JSON unchanged |
| `app/glossary.py` | Glossary lookup in the request's language: English from the Bedrock Knowledge Base if `KNOWLEDGE_BASE_ID` is set, else `glossary/*.md`; French always from `glossary/fr/*.md` (same file names, same facts) |
| `app/checks.py` | Never-words check, grounded-numbers check, conflict-named check, Bedrock `ApplyGuardrail`, the fixed refusal |
| `app/sources.py` | Collects every `Sourced` value the tools returned and keeps those the reply states |
| `app/bedrock.py` | Models, and the botocore hooks that capture the AWS request id and send `requestMetadata.action_id` |
| `app/action_log.py` | Append-only writer for the `agent_action_log` table |
| `app/prompts/` | One template per agent plus `_rules.md` (shared rules). Version: `PROMPT_VERSION` in `app/config.py` |

## One request

1. The payload is checked (`message` must be plain text, `context.locale` is `en` or `fr` when given). A malformed request gets `{"error": "invalid_request", ...}` and no model call. Every prompt tells its agent to write in the request's language (rule 7 of `_rules.md`); the fixed refusal and the fixed proposal sentence exist in both languages.
2. A `prompt_built` row is written. The orchestrator runs; each model call writes an `orchestrator_call` or `subagent_call` row and each tool call a `tool_call` row (endpoint, status, SHA-256 and size of the result).
3. The reply is checked in plain code:
   - never-words from `rules/v1.json` (`reasons.never_words`, and `reasons.never_words_fr` or the French list in `app/config.py` until the file holds one) and their inflections, plus the English and French judgement words (lists and inflections in `app/checks.py`): whole words, any case, accents significant, both languages on every reply. Exempt: exact names of 2 to 6 words from the tool results or the context, exact glossary sentences (judgement words only) and a few fixed phrases ("best bid", "bien sûr", "bons du Trésor");
   - every figure in the reply must be in a tool result of this request, the context or the user's messages. A figure matches at the precision it is written with, as is, as a percent of a fraction, or in thousands, millions or billions. A French reply's figures are read the French way ("35,0 %", "1 500,00 $"). Bare whole numbers up to 12 are treated as counts;
   - if the profile-conflict check found conflicts, their value and limit must be in the reply;
   - Bedrock `ApplyGuardrail`, source `OUTPUT`: tool results as `grounding_source`, the user's message as `query`, the reply as `guard_content`.
4. On a failure the orchestrator is asked once to rewrite. On a second failure the reply is the fixed refusal with `refused: true`. Each check writes a `guardrail_check` row.
5. The response adds a `trace` field to the contract's example: the result of each check, the number of rows written and any action-log error.

Plain-code rules on proposals (`record_proposal`): one per request; `simulated_trade` only after `check_profile_conflict` ran for that symbol; `rule_create` carries the rule exactly as the web app validated it, not what the model typed; `needsConfirm` is set by the action type.

## Run locally

```bash
cd agent
uv venv --python 3.13
uv pip install -e ".[dev]"
.venv/bin/python -m app.main                # http://localhost:8080
curl localhost:8080/ping
curl -X POST localhost:8080/invocations -H 'content-type: application/json' -d '{
  "actionId": "act_1", "userId": "demo-user", "message": "What is an ETF?", "history": [],
  "context": {"level": "Novice", "risk": "Low", "agentStyle": "teach me"}}'
```

AWS credentials come from the usual chain. The repository's `.env` is read at start.

Tests:

```bash
.venv/bin/python -m pytest                  # unit tests: no AWS, no network beyond a local stub
.venv/bin/python -m tests.live_smoke        # real models and guardrail, stub web tools; writes log rows as user "smoke-test"
.venv/bin/python -m tests.live_smoke rule   # one case: glossary, why_listed, conflict, rule
.venv/bin/python -m tests.live_smoke fr_glossary fr_why_listed fr_trade   # the same in French (context.locale "fr")
.venv/bin/python -m tests.live_smoke advice judge predict injection   # adversarial cases, only run when named
```

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `AWS_REGION` | `us-east-1` | Bedrock and DynamoDB region |
| `WEB_INTERNAL_URL` | `http://localhost:3000` | web app base URL |
| `INTERNAL_API_TOKEN` | — | sent as `x-internal-token` |
| `ORCHESTRATOR_MODEL_ID` | `us.anthropic.claude-sonnet-5-5` | |
| `SUBAGENT_MODEL_ID` | `us.anthropic.claude-haiku-5-5` | |
| `GUARDRAIL_ID`, `GUARDRAIL_VERSION` | — | Bedrock Guardrail applied to every reply. Unset: that check is skipped and logged as skipped |
| `GUARDRAIL_REPORT_ONLY` | empty | comma list of guardrail policies (`topic`, `word`, `pii`, `content`, `grounding`, `relevance`) whose blocks are logged but do not fail the reply. Empty means every block counts |
| `KNOWLEDGE_BASE_ID` | — | when set, the glossary is read with the Bedrock `Retrieve` API (not run on this account) |
| `AGENT_ACTION_LOG_TABLE` | `agent_action_log` | pk `userId`, sk `id` |
| `DYNAMODB_ENDPOINT` | — | DynamoDB Local, for example `http://localhost:8000` |
| `RULES_PATH` | `../rules/v1.json` | where the never-words are read from; the service does not start without it |
| `GLOSSARY_DIR` | `agent/glossary` | |

## Audit trail

Every Bedrock call is made with `Converse` and carries `requestMetadata {"action_id": <actionId>}`. The AWS request
id of the response is stored in the action-log row and returned in `modelCalls`. To find a call in CloudTrail
(about five minutes after it was made):

```bash
aws cloudtrail lookup-events --region us-east-1 \
  --lookup-attributes AttributeKey=EventName,AttributeValue=Converse --output json \
  | jq --arg id "$REQUEST_ID" '.Events[].CloudTrailEvent | fromjson | select(.requestID == $id)'
```

If the table cannot be reached, the request still completes: the error is printed to stderr and returned in
`trace.logErrors`, and no further row is attempted for that request.

## Deploy to AgentCore Runtime

Container (build from the repository root, so `rules/v1.json` is in the image):

```bash
docker buildx build --platform linux/arm64 -f agent/Dockerfile -t datathon-agent .
aws ecr create-repository --repository-name datathon-agent --region us-east-1
docker tag datathon-agent "$ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/datathon-agent:latest"
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin "$ACCOUNT.dkr.ecr.us-east-1.amazonaws.com"
docker push "$ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/datathon-agent:latest"
aws bedrock-agentcore-control create-agent-runtime --region us-east-1 \
  --agent-runtime-name datathon_agent \
  --agent-runtime-artifact "containerConfiguration={containerUri=$ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/datathon-agent:latest}" \
  --network-configuration networkMode=PUBLIC \
  --role-arn "$EXECUTION_ROLE_ARN" \
  --environment-variables "WEB_INTERNAL_URL=...,INTERNAL_API_TOKEN=...,GUARDRAIL_ID=...,GUARDRAIL_VERSION=..."
```

The image starts under `opentelemetry-instrument` (`aws-opentelemetry-distro`), so spans reach AgentCore
Observability once CloudWatch Transaction Search is enabled on the account.

The execution role needs: `bedrock:InvokeModel` on both inference profiles and their foundation models in
us-east-1, us-east-2 and us-west-2; `bedrock:ApplyGuardrail`; `dynamodb:PutItem` on the action-log table;
`bedrock:Retrieve` if a Knowledge Base is used; the logs, X-Ray and ECR permissions listed in the AgentCore
runtime permissions page. The runtime must be able to reach `WEB_INTERNAL_URL`.

The image was built and started locally (`/ping` answers). It has not been pushed or deployed from this
checkout, and the `create-agent-runtime` command above is from the documentation, not from a run.

The web app then calls `InvokeAgentRuntime` with the same payload; the response body is the same JSON.
