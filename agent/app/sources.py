"""Collects every Sourced value the tools returned and keeps the ones the reply uses."""
import re

from . import checks

LABELS = {
    "price": "price", "changePercent": "% change", "marketCapUsd": "market cap",
    "avgDailyTradedValueUsd": "average daily traded value", "volatility1y": "1-year volatility",
    "beta": "beta", "pe": "P/E", "revenueGrowthPct": "revenue growth", "sectorLabel": "sector",
    "closes1m": "1-month closes", "newsCount7d": "news count (7 days)", "valueCad": "value (CAD)",
    "currentPrice": "price", "fxUsdCad": "USD/CAD rate",
}


_DATE_OR_TIME = re.compile(r"\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?|\d{1,2}:\d{2}(?::\d{2})?")


def is_sourced(node) -> bool:
    return isinstance(node, dict) and "value" in node and "source" in node and "fetchedAt" in node


def collect(tool_results: list) -> list[dict]:
    """Every Sourced value in the tool results, with the symbol it belongs to and a label.
    Glossary documents are collected too: their source is the document's location."""
    found = []

    def walk(node, key, symbol):
        if is_sourced(node):
            name = LABELS.get(key, key or "value")
            found.append({
                "label": f"{symbol} {name}" if symbol else name,
                "source": node["source"], "fetchedAt": node["fetchedAt"], "asOf": node.get("asOf"),
                "symbol": symbol, "value": node["value"],
            })
        elif isinstance(node, dict):
            if isinstance(node.get("symbol"), str):
                symbol = node["symbol"]
            if "location" in node and "title" in node and "text" in node:
                found.append({"label": f"Glossary: {node['title']}", "source": node["location"],
                              "document": node["title"]})
            for child_key, child in node.items():
                walk(child, child_key, symbol)
        elif isinstance(node, list):
            for child in node:
                walk(child, key, symbol)

    for item in tool_results:
        walk(item["result"], None, None)
    return found


def _mentions(text: str, word: str) -> bool:
    return re.search(rf"(?<!\w){re.escape(word)}(?!\w)", text, re.IGNORECASE) is not None


def relevant(collected: list[dict], reply: str) -> list[dict]:
    """A value is kept when the reply states it (and names its symbol, when it has one).
    A glossary document is kept when the reply names its location or its title."""
    # Bare small whole numbers ("1-year", list numbers) are not figures and must not match a value.
    # Dates and times are left out too, so "15:30" is not read as a value of 15 or 30.
    figures_only = _DATE_OR_TIME.sub(" ", reply)
    written = [n for n in checks.numbers_in_text(figures_only) if n["marked"] or n["value"] > checks._SMALL]
    kept, seen = [], set()
    # Values that carry a symbol come first, so a repeat of the same value without one is dropped.
    for item in sorted(collected, key=lambda entry: not entry.get("symbol")):
        if "document" in item:
            short_title = item["document"].split(" (")[0]
            used = item["source"] in reply or _mentions(reply, short_title)
        elif item["symbol"] and not _mentions(reply, item["symbol"]):
            used = False
        elif isinstance(item["value"], (int, float)) and not isinstance(item["value"], bool):
            used = any(checks.matches(n["value"], n["decimals"], [abs(float(item["value"]))]) for n in written)
        else:
            used = isinstance(item["value"], str) and item["value"].lower() in reply.lower()
        key = (item["source"], item.get("fetchedAt"), str(item.get("value", item["label"])))
        if used and key not in seen:
            seen.add(key)
            entry = {"label": item["label"], "source": item["source"]}
            for field in ("fetchedAt", "asOf"):
                if item.get(field):
                    entry[field] = item[field]
            kept.append(entry)
    return kept
