"""The seven subagents. Each is a Strands Agent on the subagent model with only its own tools and its
slice of the context. The orchestrator reaches them as tools; they never reach each other or the user."""
from strands import Agent, tool

from . import bedrock, prompts, trace, web_tools

SUBAGENTS = {
    "market_data": {
        "tools": [web_tools.get_market_data],
        "description": "Quotes and company signals for given symbols; bond yields, gold and crypto. "
                       "Give the symbols in the task.",
    },
    "watchlist_explainer": {
        "tools": [web_tools.explain_pick],
        "description": "Why one symbol is, or is not, on the user's smart watchlist, from the decision log.",
    },
    "portfolio": {
        "tools": [web_tools.get_portfolio, web_tools.get_portfolio_stats],
        "description": "The simulated portfolio: holdings, value, sector split; return, drawdown or correlation "
                       "over 1m, 3m or 1y.",
    },
    "rules": {
        "tools": [web_tools.validate_rule, web_tools.list_rules],
        "description": "Turns the user's words into a simulated rule and validates it; lists existing rules "
                       "with their ids. Pass the user's exact words.",
    },
    "layout": {
        "tools": [web_tools.get_layout],
        "description": "Reads the dashboard layout and the widget library and works out the new widget order "
                       "for a request such as 'show me less'.",
    },
    "profile": {
        "tools": [web_tools.preview_profile_change],
        "description": "Previews a change of level, risk or interests by re-running the Level and Risk rules.",
    },
    "glossary": {
        "tools": [web_tools.search_glossary],
        "description": "Explains a term (ETF, P/E, volatility...) from the vetted glossary only, with the "
                       "document's location.",
    },
}


def message_text(message) -> str:
    """The text blocks of a model message (reasoning blocks are left out)."""
    return "\n".join(block["text"] for block in (message or {}).get("content", []) if "text" in block).strip()


def run_subagent(name: str, task: str) -> str:
    current = trace.current()
    token = trace.set_actor(f"subagent:{name}")
    try:
        with current.stage("subagent", name) as done:
            try:
                agent = Agent(
                    model=bedrock.subagent_model(),
                    system_prompt=prompts.render(name, current.context),
                    tools=SUBAGENTS[name]["tools"],
                    callback_handler=None,
                )
                return message_text(agent(task).message) or "No answer from this specialist: treat the data as unavailable."
            except Exception as exc:
                done["ok"] = False
                current.log("error", result={"error": type(exc).__name__, "detail": str(exc)[:300]})
                return "This specialist failed: treat the data as unavailable."
    finally:
        trace.reset_actor(token)


def _as_tool(name: str):
    @tool(name=name, description=SUBAGENTS[name]["description"])
    def specialist(task: str) -> str:
        return run_subagent(name, task)

    return specialist


SUBAGENT_TOOLS = [_as_tool(name) for name in SUBAGENTS]
