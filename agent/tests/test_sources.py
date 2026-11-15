from app import sources
from tests.stub_web import ENB, FETCHED, TSLA, conflict_check

RESULTS = [
    {"endpoint": "/api/internal/tools/conflict-check", "result": conflict_check({"symbol": "TSLA"})},
    {"endpoint": "/api/internal/tools/market-data", "result": {"items": [TSLA, ENB]}},
    {"endpoint": "glossary", "result": {"documents": [
        {"title": "Volatility", "text": "# Volatility ...", "location": "agent/glossary/volatility.md", "score": 4}]}},
]


def test_collect_finds_every_sourced_value_with_its_symbol():
    found = sources.collect(RESULTS)
    labels = [item["label"] for item in found]
    assert "TSLA price" in labels and "ENB 1-year volatility" in labels and "Glossary: Volatility" in labels
    price = next(item for item in found if item["label"] == "ENB price")
    assert price["source"] == "Finnhub" and price["fetchedAt"] == FETCHED and price["value"] == 41.75
    assert len([item for item in found if "document" not in item]) == 3 * 7   # 7 sourced values per signal set


def test_only_values_stated_in_the_reply_are_returned():
    reply = "TSLA trades at 251.3 USD; its 1-year volatility is 58.4% (see agent/glossary/volatility.md)."
    kept = sources.relevant(sources.collect(RESULTS), reply)
    assert kept == [
        {"label": "TSLA price", "source": "Finnhub", "fetchedAt": FETCHED, "asOf": "2026-11-14T15:29:00.000Z"},
        {"label": "TSLA 1-year volatility", "source": "derived from Yahoo chart (unofficial) daily closes",
         "fetchedAt": FETCHED},
        {"label": "Glossary: Volatility", "source": "agent/glossary/volatility.md"},
    ]


def test_a_value_of_another_symbol_is_not_attributed():
    kept = sources.relevant(sources.collect(RESULTS), "Something costs 41.75 today.")
    assert kept == []


def test_no_tool_results_no_sources():
    assert sources.relevant(sources.collect([]), "Hello.") == []


def test_dates_and_times_in_the_reply_do_not_match_values():
    reply = "ENB price: 41.75 USD, as of 2026-11-14 15:29 UTC (Finnhub, fetched 16:19 UTC), 1-year view."
    kept = sources.relevant(sources.collect(RESULTS), reply)
    assert [item["label"] for item in kept] == ["ENB price"]   # not P/E 19.4, volatility 0.162 or beta
