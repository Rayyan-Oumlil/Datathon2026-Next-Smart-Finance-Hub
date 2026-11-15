"""The orchestrator: a Strands Agent whose only tools are the subagents and two control tools."""
from strands import Agent, tool

from . import bedrock, prompts, subagents, trace, web_tools

NEEDS_CONFIRM = {
    "reply": False, "lookup": False, "explain_pick": False,
    "layout_change": True, "rule_create": True, "rule_pause": True, "profile_change": True, "simulated_trade": True,
}
REQUIRED_PARAMS = {
    "lookup": ["symbols"], "explain_pick": ["symbol"], "layout_change": ["layout"], "rule_create": [],
    "rule_pause": ["ruleId", "status"], "profile_change": ["changes"], "simulated_trade": ["symbol", "side"],
}


def _last_result(current: trace.RequestTrace, endpoint_suffix: str):
    for item in reversed(current.tool_results):
        if item["endpoint"].endswith(endpoint_suffix):
            return item["result"]
    return None


def record_proposal(current: trace.RequestTrace, action_type: str, summary: str, params: dict) -> str:
    """Plain-code checks on a proposal, then stores it for the web app to preview. Returns a note for the model."""
    if current.proposed is not None:
        return "Not recorded: one action is already proposed for this request."
    if action_type not in NEEDS_CONFIRM or action_type == "reply":
        return f"Not recorded: unknown action type. Allowed: {', '.join(t for t in NEEDS_CONFIRM if t != 'reply')}."
    params = dict(params or {})
    missing = [name for name in REQUIRED_PARAMS[action_type] if name not in params]
    if missing:
        return f"Not recorded: params is missing {', '.join(missing)}."
    proposal = {"type": action_type, "summary": summary, "params": params,
                "needsConfirm": NEEDS_CONFIRM[action_type]}

    if action_type == "simulated_trade":
        symbol = str(params["symbol"]).upper()
        if symbol not in current.conflict_checks:
            return f"Not recorded: call check_profile_conflict('{symbol}') first, then propose again."
        if params.get("side") not in ("buy", "sell") or not (params.get("amountCad") or params.get("quantity")):
            return 'Not recorded: side must be "buy" or "sell", with amountCad or quantity.'
        params["symbol"] = symbol
    elif action_type == "rule_create":
        if current.validated_rule is None:
            return "Not recorded: ask the rules specialist to validate the rule first, then propose again."
        # The rule the web app validated is used as is; nothing the model retyped reaches the preview.
        params["rule"] = {k: v for k, v in current.validated_rule.items() if k not in ("id", "createdAt")}
    elif action_type == "layout_change":
        layout = _last_result(current, "/layout")
        if layout:
            proposal["before"], proposal["after"] = layout.get("current"), params["layout"]
    elif action_type == "profile_change":
        preview = _last_result(current, "/profile-preview")
        if preview:
            proposal["before"], proposal["after"] = preview.get("before"), preview.get("after")

    current.proposed = proposal
    if proposal["needsConfirm"]:
        return "Recorded. The app will show a preview; nothing is applied until the user confirms."
    return "Recorded."


@tool
def propose_action(type: str, summary: str, params: dict) -> str:
    """Records ONE proposed action for the app to preview. Nothing is applied by this call.

    Args:
        type: layout_change, rule_create, rule_pause, profile_change, simulated_trade, explain_pick or lookup.
        summary: one plain sentence describing the proposal, for the preview.
        params: the parameters for this action type, as listed in your instructions.
    """
    return record_proposal(trace.current(), type, summary, params)


# The orchestrator holds no data tools: it gets the conflicts, never the asset's signals or their sources.
CONFLICT_FIELDS = ("symbol", "conflicts", "level", "risk")


def conflict_view(result: dict) -> dict:
    """The part of a conflict-check result the model sees. The full result stays in the request's tool
    results, so the reply's sources still cite the values behind each conflict."""
    return {key: result.get(key) for key in CONFLICT_FIELDS}


@tool
def check_profile_conflict(symbol: str) -> dict:
    """Checks one asset against the user's profile filters. Returns the conflicts (each with a detail giving
    the actual values) and the user's level and risk. Call it before discussing or simulating a trade in an
    asset."""
    result = web_tools.call_web("conflict-check", {"symbol": symbol})
    if not isinstance(result, dict) or "error" in result:
        return result
    trace.current().conflict_checks[symbol.upper()] = result
    return conflict_view(result)


def history_messages(history: list) -> list:
    """The last turns as Converse messages: starts with the user, roles alternate."""
    messages = []
    for turn in (history or [])[-10:]:
        role, text = turn.get("role"), str(turn.get("text") or "").strip()
        if role not in ("user", "assistant") or not text:
            continue
        if messages and messages[-1]["role"] == role:
            messages[-1]["content"][0]["text"] += "\n" + text
        elif messages or role == "user":
            messages.append({"role": role, "content": [{"text": text}]})
    if messages and messages[-1]["role"] == "user":
        messages.pop()  # the new message is a user turn
    return messages


def build(current: trace.RequestTrace) -> Agent:
    return Agent(
        model=bedrock.orchestrator_model(),
        system_prompt=prompts.render("orchestrator", current.context),
        messages=history_messages(current.history),
        tools=[*subagents.SUBAGENT_TOOLS, propose_action, check_profile_conflict],
        callback_handler=None,
    )


def ask(agent: Agent, text: str) -> str:
    return subagents.message_text(agent(text).message)
