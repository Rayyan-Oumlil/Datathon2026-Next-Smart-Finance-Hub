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
    current.emit("tool", "start", name)
    def post():
        return _client().post(
            config.web_url() + endpoint,
            json={**(body or {}), "userId": current.user_id},
            headers={"x-internal-token": config.env("INTERNAL_API_TOKEN"), "x-action-id": current.action_id},
        )

    def is_json(response) -> bool:
        return "json" in response.headers.get("content-type", "")

    try:
        response = post()
        status = response.status_code
        if (status == 404 or status < 300) and not is_json(response):
            # The Next dev server sometimes answers a route it is recompiling with an HTML page (404, or 200 while
            # it reloads): asked again once
            response = post()
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


XRAY_DIRECTIONS = ("add", "reduce")
XRAY_WINDOWS = ("full", "last3y", "last1y")


def _xray_for_model(result):
    """What the portfolio specialist reads. The full result (every figure repeated as a sourced value, the list of
    series) stays in the request's tool results, where plain code takes the reply's sources from it; the model
    gets the figures once, with a single `source` line, so its report fits its output limit."""
    if not isinstance(result, dict) or "error" in result:
        return result
    if "before" in result and "after" in result:
        return {**result, "before": _xray_for_model(result["before"]), "after": _xray_for_model(result["after"])}
    figures = result.get("figures") or {}
    first = next((v for v in figures.values() if isinstance(v, dict) and "source" in v), None)
    slim = {k: v for k, v in result.items() if k not in ("figures", "sources", "assumptions")}
    if first:
        slim["source"] = first["source"]
        slim["fetchedAt"] = first["fetchedAt"]
        if first.get("asOf"):
            slim["asOf"] = first["asOf"]
    return slim


@tool
def get_portfolio_xray(window: str = "full", symbol: str | None = None, amount_cad: float | None = None,
                       direction: str | None = None) -> dict:
    """The X-ray of the simulated portfolio. Read-only: nothing is traded or stored.

    Without arguments: concentration (largest holding, top 3, effective holdings, groups, asset classes,
    currencies), each holding's share of the risk, and three replay windows (full period of up to 5 years, last 3 years, last
    1 year) with volatility, maximum drawdown, worst day, worst twenty-trading-day span (worstSpan20) and correlations, plus the
    user's risk band and answer to the profile's market-drop question. The replay is a scenario: today's proportions applied
    to past days. It is not what the portfolio earned and never a forecast.

    With symbol, amount_cad and direction (all three together): the X-ray before and after that hypothetical
    change, and the profile conflicts an addition would raise, with their values.

    Args:
        window: the one replay period to report: "full" (up to 5 years), "last3y" (3 years) or "last1y" (1 year).
        symbol: the asset to add or reduce.
        amount_cad: the amount of the change in CAD, greater than 0.
        direction: "add" or "reduce".
    """
    if window not in XRAY_WINDOWS:
        return {"error": 'window must be "full", "last3y" or "last1y"'}
    given = [value is not None for value in (symbol, amount_cad, direction)]
    body: dict = {"locale": trace.current().locale, "window": window}
    if not any(given):
        return _xray_for_model(call_web("portfolio-xray", body))
    if not all(given):
        return {"error": "symbol, amount_cad and direction must be given together, or none of them"}
    if direction not in XRAY_DIRECTIONS:
        return {"error": 'direction must be "add" or "reduce"'}
    if isinstance(amount_cad, bool) or not isinstance(amount_cad, (int, float)) or not amount_cad > 0:
        return {"error": "amount_cad must be a number greater than 0"}
    if not str(symbol).strip():
        return {"error": "symbol must not be empty"}
    change = {"symbol": str(symbol).strip(), "amountCad": amount_cad, "direction": direction}
    return _xray_for_model(call_web("portfolio-xray", {"change": change, **body}))


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


# ---- strategies and the time machine
REPLAY_PORTFOLIOS = ("current", "amira", "mateo", "robert")


@tool
def list_strategies(make_room_for_symbol: str | None = None, make_room_for_weight_pct: float | None = None) -> dict:
    """The user's stored strategies (id, name, version, each rule with its sentence), the simulated portfolio's
    current weights in percent and its value. With make_room_for_symbol and make_room_for_weight_pct together: also
    targetsWithRoom, the current weights scaled down (computed by the app) so that symbol takes that weight; use it
    as the targets of an allocation_target rule. Read-only.

    Args:
        make_room_for_symbol: optional symbol to add as a target, for example "TSLA".
        make_room_for_weight_pct: its target weight in percent (0.1 to 100), for example 20.
    """
    body: dict = {"locale": trace.current().locale}
    if (make_room_for_symbol is None) != (make_room_for_weight_pct is None):
        return {"error": "make_room_for_symbol and make_room_for_weight_pct must be given together"}
    if make_room_for_symbol is not None:
        body["makeRoomFor"] = {"symbol": str(make_room_for_symbol).strip(), "weightPct": make_room_for_weight_pct}
    return call_web("strategies", body)


@tool
def validate_strategy(strategy: dict) -> dict:
    """Checks a strategy against the app's strict schema. Nothing is saved. Returns validation.ok with the
    normalised strategy and one sentence per rule, or validation.ok false with errors and issues (code, path,
    values): correct exactly those fields once and check again.

    Args:
        strategy: {"name": "...", "rules": [ ...rules, see your instructions for each kind... ]}.
    """
    result = call_web("strategies", {"locale": trace.current().locale, "validate": strategy})
    validation = result.get("validation") if isinstance(result, dict) else None
    if isinstance(validation, dict) and validation.get("ok"):
        trace.current().validated_strategy = validation.get("strategy")
        return {"validation": validation}
    return {"validation": validation} if validation else result


@tool
def run_replay(portfolio: str = "current", strategy: dict | None = None, strategy_id: str | None = None,
               start_date: str | None = None, fee_per_order_cad: float | None = None) -> dict:
    """Replays a portfolio on the app's frozen historical snapshot, without rules and with a strategy, same capital,
    fees and data. Returns a digest: final value, total and annualised return, volatility, largest fall (with dates),
    fees, how many times each rule fired, the first rule events as sentences, reference portfolios, the replay id and
    the snapshot id. Illustrative replay on historical data, never a prediction. Read-only; the run is logged.

    Args:
        portfolio: "current" (the simulated portfolio as it stands) or an example profile: "amira", "mateo", "robert".
        strategy: a strategy {"name", "rules"} to test (not saved). Give this or strategy_id, or neither (no rule).
        strategy_id: the id of a stored strategy (from list_strategies or the context).
        start_date: YYYY-MM-DD, default 2021-01-04 (about five years).
        fee_per_order_cad: fee per order in CAD, default 0.
    """
    if portfolio not in REPLAY_PORTFOLIOS:
        return {"error": 'portfolio must be "current", "amira", "mateo" or "robert"'}
    if strategy is not None and strategy_id is not None:
        return {"error": "give strategy or strategy_id, not both"}
    body: dict = {"locale": trace.current().locale, "portfolio": portfolio,
                  "strategy": strategy if strategy is not None else strategy_id}
    if start_date:
        body["startDate"] = start_date
    if fee_per_order_cad is not None:
        body["feePerOrderCad"] = fee_per_order_cad
    result = call_web("replay", body)
    if isinstance(result, dict) and "replayId" in result:
        trace.current().replays.append(result["replayId"])
    return result


# ---- layout
@tool
def get_layout() -> dict:
    """The current widget order and the widget library (id, title, fixed, minimum level). The titles are in the
    user's language, as the app shows them."""
    return call_web("layout", {"locale": trace.current().locale})


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
    """Looks a term up in the vetted glossary, in the user's language. Returns the matching documents with
    their location."""
    current = trace.current()
    started = time.monotonic()
    result = glossary.search(query, locale=current.locale)
    current.record_tool("glossary", {"query": query, "locale": current.locale}, result, None,
                        int((time.monotonic() - started) * 1000))
    return result
