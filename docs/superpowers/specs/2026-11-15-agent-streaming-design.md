# Agent reply streaming: design

## Intent
The agent panel waits for one JSON reply that comes after several model calls and two guardrail passes. Show the
orchestration while it runs (which specialist is working, which tool was called, the checks), then reveal the
verified reply progressively. Faster to feel, and it shows the agentic orchestration the jury scores.

## Goals / non-goals / anti-goals
- Goals: live stage events; the final text is revealed progressively; the audit trail and the numbers are unchanged.
- Non-goals: token streaming of model output; changing models, prompts, guardrails or the action log.
- Anti-goal: any text shown to the user that did not pass the word check and the guardrail.

## Approaches considered
| | Effect | Trade-off |
|---|---|---|
| A. raw token streaming | smoothest | shows unchecked text; breaks the invariant; needs ConverseStream and new audit hooks |
| B. stage events only | shows progress | total time unchanged |
| C. verified reply revealed progressively | typing effect | rendering only |
| **D. B + C (chosen)** | progress while the work runs, then verified text | one SSE path end to end |

## Design
- Agent service: `invoke` stays JSON unless the payload has `"stream": true`; then it returns a generator and
  AgentCore sends `text/event-stream` (the SDK picks the response type from what the handler returns). The work runs
  in a worker thread that pushes events to a queue; the generator yields them, plus a heartbeat every 10 s so the
  ALB (60 s idle timeout by default) never sees a silent connection. Models stay on `Converse`: audit hooks and
  CloudTrail are untouched.
- Events (one JSON object per SSE `data:` line): `stage` (`orchestrator`, `subagent`, `tool`, `guardrail`, `retry`;
  `state` start or done; `name`, `ok`, `ms`, `attempt`, `passed` where they apply), `heartbeat`, `final` (the existing
  reply body), `error`.
- Web: `POST /api/agent/stream` returns SSE. It runs the same `chat()` pipeline (word check, router, log rows) with an
  `onStage` callback, and sends `final` only after the pipeline finished. `/api/agent` (JSON) is unchanged.
- Panel: shows the stages as a live list, then reveals the final text word by word (instant under reduced motion).
  A broken stream shows an error; it never falls back silently.
- Infra: ALB `idle_timeout` to 300 s; response headers `Cache-Control: no-cache, no-transform` and
  `X-Accel-Buffering: no`.

## Left to the builder / open
- Confirm on the real AgentCore runtime and the real ALB that events arrive in order (needs the Workshop role, not
  the personal AWS account).
- A client that disconnects cannot cancel an in-flight model call; the worker finishes and the log stays complete.
