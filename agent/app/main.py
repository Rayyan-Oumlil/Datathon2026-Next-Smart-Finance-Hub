"""Service entrypoint. The same code runs locally (python -m app.main) and on AgentCore Runtime:
POST /invocations and GET /ping on port 8080. Request and response: docs/agent-api.md section 1."""
import sys
import time

from bedrock_agentcore import BedrockAgentCoreApp

from . import checks, config, orchestrator, prompts, sources, stream, trace

app = BedrockAgentCoreApp()

LEVELS = ("Novice", "Intermediate", "Expert")
PAGES = ("portfolio", "xray", "overview", "profile", "stock", "strategy", "time_machine")


def parse_request(payload) -> trace.RequestTrace:
    """Checks the payload shape. Anything that is not plain text where text is expected is rejected."""
    if not isinstance(payload, dict):
        raise ValueError("payload must be a JSON object")
    for name in ("actionId", "userId", "message"):
        if not isinstance(payload.get(name), str) or not payload[name].strip():
            raise ValueError(f"{name} must be a non-empty string")
    context = payload.get("context") or {}
    history = payload.get("history") or []
    if not isinstance(context, dict):
        raise ValueError("context must be an object")
    if context.get("level") is not None and context["level"] not in LEVELS:
        raise ValueError("context.level must be Novice, Intermediate or Expert")
    page = context.get("page")
    if page is not None and not (isinstance(page, dict) and page.get("name") in PAGES):
        raise ValueError("context.page.name must be portfolio, xray, overview, profile, stock, strategy or time_machine")
    if context.get("locale") is not None and context["locale"] not in config.LOCALES:
        raise ValueError("context.locale must be en or fr")
    if not isinstance(history, list) or not all(
            isinstance(t, dict) and isinstance(t.get("text"), str) and t.get("role") in ("user", "assistant")
            for t in history):
        raise ValueError("history must be a list of {role, text}")
    return trace.RequestTrace(action_id=payload["actionId"], user_id=payload["userId"],
                              message=payload["message"], context=context, history=history[-10:])


def response(current: trace.RequestTrace, text: str, refused: bool, guardrail: list, error: str | None = None) -> dict:
    body = {
        "actionId": current.action_id,
        "text": text,
        "sources": [] if refused else sources.relevant(sources.collect(current.tool_results, current.locale), text,
                                                       current.locale),
        "refused": refused,
        "promptVersion": config.PROMPT_VERSION,
        "modelCalls": current.model_calls,
        # False when a row of this request could not be written to the action log, even after a retry.
        "logComplete": not current.log_errors,
        # Not in the contract's example: what the checks found and whether the action log could be written.
        "trace": {"guardrail": guardrail, "toolCalls": len(current.tool_results),
                  "logRows": current.log_rows, "logErrors": current.log_errors,
                  # True when writes stopped after repeated failures; logSkipped rows were then not attempted.
                  "logStopped": current.log_stopped, "logSkipped": current.log_skipped},
    }
    if current.proposed and not refused:
        body["proposed"] = current.proposed
    conflicts = [(symbol, result.get("conflicts") or []) for symbol, result in current.conflict_checks.items()]
    conflicts = [(symbol, found) for symbol, found in conflicts if found]
    if conflicts:
        body["conflict"] = {"symbol": conflicts[-1][0], "checks": conflicts[-1][1]}
    if error:
        body["trace"]["error"] = error
    return body


# The fixed preview sentence per action type, in each language.
ACTION_NAMES = {
    "en": {"layout_change": "layout change", "rule_create": "new rule", "rule_pause": "rule pause or resume",
           "profile_change": "profile change", "simulated_trade": "simulated trade", "explain_pick": "explanation",
           "lookup": "lookup", "strategy_propose": "strategy"},
    "fr": {"layout_change": "modification de la disposition", "rule_create": "nouvelle règle",
           "rule_pause": "suspension ou reprise d'une règle", "profile_change": "modification du profil",
           "simulated_trade": "opération simulée", "explain_pick": "explication", "lookup": "consultation",
           "strategy_propose": "stratégie"},
}


def neutral_summary(action_type: str, locale: str) -> str:
    name = ACTION_NAMES[locale].get(action_type, action_type.replace("_", " "))
    return f"Proposition : {name} (simulation)." if locale == "fr" else f"Proposed {name} (simulation)."


def check_reply(current: trace.RequestTrace, text: str, attempt: int) -> tuple[dict, str]:
    """Runs our own check and the Bedrock Guardrail on one reply, and logs both. Returns (result, text)."""
    current.emit("guardrail", "start")
    started = time.monotonic()
    conflicts = [c for result in current.conflict_checks.values() for c in (result.get("conflicts") or [])]
    # Only what this request's tools returned, the context the web app built and the params of the action
    # proposed in this request (recorded by propose_action, so a reply may repeat its amount) ground a figure;
    # the client-supplied history and message do not.
    proposed_params = current.proposed["params"] if current.proposed else None
    data = [current.tool_results, current.context, proposed_params]
    own = checks.own_check(text, data, conflicts, current.locale)
    proposal_words = checks.find_never_words(current.proposed["summary"]) if current.proposed else []
    if proposal_words:
        # The summary is shown in the preview; a fixed neutral sentence replaces one that breaks the word rule.
        current.proposed["summary"] = neutral_summary(current.proposed["type"], current.locale)
    try:
        guardrail = checks.bedrock_check(text, checks.grounding_text(current.tool_results, current.context, proposed_params),
                                         current.message) if not own["empty"] else {"passed": False, "skipped": "empty"}
    except Exception as exc:  # a guardrail that cannot be reached is a failed check, not a pass
        guardrail = {"passed": False, "error": f"{type(exc).__name__}: {str(exc)[:200]}"}
    passed = own["passed"] and guardrail["passed"]
    if passed and guardrail.get("maskedText"):
        text = guardrail["maskedText"]
    result = {"attempt": attempt, "passed": passed, "own": own, "bedrock": guardrail,
              "summaryReplaced": bool(proposal_words)}
    current.log("guardrail_check", "writer", awsRequestId=guardrail.get("awsRequestId"),
                replySha256=trace.sha256(text), result=result)
    current.emit("guardrail", "done", attempt=attempt, passed=passed, ms=int((time.monotonic() - started) * 1000))
    return result, text


def handle(payload, on_event=None) -> dict:
    """Runs one request. on_event, when given, receives a stage event as each step starts and finishes."""
    current = parse_request(payload)
    current.on_event = on_event
    token = trace.start(current)
    guardrail_results = []
    try:
        system_prompt = prompts.render("orchestrator", current.context)
        current.log("prompt_built", "writer", promptSha256=trace.sha256(system_prompt), dataUsed={
            "level": current.context.get("level"), "risk": current.context.get("risk"), "locale": current.locale,
            "agentStyle": current.context.get("agentStyle"), "contextKeys": sorted(current.context),
            "historyTurns": len(current.history), "messageSha256": trace.sha256(current.message)})
        agent = orchestrator.build(current)
        with current.stage("orchestrator"):
            text = orchestrator.ask(agent, current.message)
        for attempt in range(1, config.MAX_GUARDRAIL_FAILURES + 1):
            result, text = check_reply(current, text, attempt)
            guardrail_results.append(result)
            if result["passed"]:
                return response(current, text, False, guardrail_results)
            if attempt < config.MAX_GUARDRAIL_FAILURES:
                with current.stage("retry"):
                    text = orchestrator.ask(agent, checks.corrective_instruction(result["own"], result["bedrock"],
                                                                                 current.locale))
        return response(current, checks.safe_refusal(current.locale), True, guardrail_results)
    except Exception as exc:
        error = f"{type(exc).__name__}: {str(exc)[:300]}"
        print(f"request {current.action_id} failed: {error}", file=sys.stderr)
        current.log("error", "writer", result={"error": error})
        return response(current, checks.safe_refusal(current.locale), True, guardrail_results, error)
    finally:
        trace._current.reset(token)


def answer(payload, on_event=None) -> dict:
    try:
        return handle(payload, on_event)
    except ValueError as exc:  # a malformed request: nothing was sent to a model
        context = payload.get("context") if isinstance(payload, dict) else None
        text = checks.safe_refusal(config.locale_of(context))
        return {"error": "invalid_request", "detail": str(exc), "refused": True, "text": text,
                "sources": [], "promptVersion": config.PROMPT_VERSION, "modelCalls": []}


@app.entrypoint
def invoke(payload):
    """One JSON reply, or, when the payload asks for "stream": true, a generator of events that AgentCore
    sends as server-sent events (docs/agent-api.md section 1)."""
    if isinstance(payload, dict) and payload.get("stream") is True:
        return stream.events(payload, answer)
    return answer(payload)


if __name__ == "__main__":
    # AgentCore Runtime expects 8080; PORT moves a local run elsewhere (for example next to another checkout)
    app.run(port=int(config.env("PORT", "8080") or 8080))
