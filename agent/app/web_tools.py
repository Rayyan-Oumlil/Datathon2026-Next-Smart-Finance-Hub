"""Thin HTTP clients for the web app's internal endpoints (docs/agent-api.md section 2).

Each tool returns the web app's JSON unchanged, so every figure reaches the model with its
source and time. Nothing here computes a number.
"""
import time
from functools import lru_cache
from typing import Any

import httpx
from strands import tool

from . import config, glossary, trace

TOOLS = "/api/internal/tools/"


@lru_cache(maxsize=None)
def _client() -> httpx.Client:
    return httpx.Client(timeout=httpx.Timeout(15.0, connect=3.0))


def call_web(name: str, body: dict | None = None) -> Any:
    """POSTs to one internal endpoint. On any failure returns {"error": ...} instead of raising."""
    current = trace.current()
    endpoint = TOOLS + name
    started = time.monotonic()
    status = None
    try:
        response = _client().post(
            config.web_url() + endpoint,
            json={**(body or {}), "userId": current.user_id},
            headers={"x-internal-token": config.env("INTERNAL_API_TOKEN"), "x-action-id": current.action_id},
        )
        status = response.status_code
        if status >= 400:
            result = {"error": f"HTTP {status}", "endpoint": endpoint}
        else:
            result = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        result = {"error": type(exc).__name__, "endpoint": endpoint}
    current.record_tool(endpoint, body or {}, result, status, int((time.monotonic() - started) * 1000))
    return result


# ---- market data
@tool
def get_market_data(symbols: list[str]) -> dict:
    """Signals for each symbol (price, % change, market cap, 1-year volatility, beta, P/E, sector, news count),
    each value with its source and fetch time. Also accepts GOLD, BTC, ETH, CA2Y, CA5Y, CA10Y."""
    return call_web("market-data", {"symbols": symbols})


# ---- watchlist explainer
@tool
def explain_pick(symbol: str) -> dict:
    """What the decision log holds for one symbol: whether it is on the smart watchlist, its factor scores and
    reason sentence, or the filters it failed, with the snapshot id, time and rule versions."""
    return call_web("explain-pick", {"symbol": symbol})


# ---- portfolio
@tool
def get_portfolio() -> dict:
    """The simulated portfolio: cash, positions with price, value and return, and the split by sector."""
    return call_web("portfolio")


@tool
def get_portfolio_stats(metric: str, period: str, symbols: list[str] | None = None) -> dict:
    """One fixed calculation on the simulated portfolio.

    Args:
        metric: "return", "drawdown" or "correlation".
        period: "1m", "3m" or "1y".
        symbols: optional subset of symbols.
    """
    body = {"metric": metric, "period": period}
    if symbols:
        body["symbols"] = symbols
    return call_web("portfolio-stats", body)


# ---- rules
@tool
def validate_rule(text: str, symbol: str, trigger_type: str, trigger_value: float, side: str,
                  amount_cad: float | None = None, quantity: float | None = None, once: bool = True) -> dict:
    """Checks a simulated rule and returns it in structured form, or the errors.

    Args:
        text: the user's own words for the rule.
        symbol: the asset.
        trigger_type: "price_below", "price_above", "change_pct_below" or "change_pct_above".
        trigger_value: the price or percent that triggers the rule.
        side: the rule's side field, "buy" or "sell" (a field value, not wording for a reply).
        amount_cad: amount in CAD, or leave empty and give quantity.
        quantity: number of units, or leave empty and give amount_cad.
        once: true if the rule fires a single time.
    """
    action = {"side": side}
    if amount_cad is not None:
        action["amountCad"] = amount_cad
    if quantity is not None:
        action["quantity"] = quantity
    rule = {"text": text, "symbol": symbol, "trigger": {"type": trigger_type, "value": trigger_value},
            "action": action, "once": once}
    result = call_web("validate-rule", {"rule": rule})
    if isinstance(result, dict) and result.get("ok") and isinstance(result.get("rule"), dict):
        trace.current().validated_rule = result["rule"]
    return result


@tool
def list_rules() -> dict:
    """The user's simulated rules with their ids and status."""
    return call_web("rules")


# ---- layout
@tool
def get_layout() -> dict:
    """The current widget order and the widget library (id, title, fixed, minimum level)."""
    return call_web("layout")


# ---- profile
@tool
def preview_profile_change(changes: dict) -> dict:
    """Re-runs the Level and Risk rules with the given profile changes and returns before / after.
    Nothing is saved.

    Args:
        changes: fields to change, for example {"risk": "High"} or {"sectors": ["Energy"]}.
    """
    return call_web("profile-preview", {"changes": changes})


# ---- glossary (read by this service itself, not the web app)
@tool
def search_glossary(query: str) -> dict:
    """Looks a term up in the vetted glossary. Returns the matching documents with their location."""
    started = time.monotonic()
    result = glossary.search(query)
    trace.current().record_tool("glossary", {"query": query}, result, None, int((time.monotonic() - started) * 1000))
    return result
