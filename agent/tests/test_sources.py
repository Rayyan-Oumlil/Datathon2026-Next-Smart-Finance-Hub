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
    # 7 sourced values per signal set, and the one value behind the TSLA conflict
    assert len([item for item in found if "document" not in item]) == 2 * 7 + 1


def test_only_values_stated_in_the_reply_are_returned():
    reply = "TSLA trades at 251.3 USD; its 1-year volatility is 58.4% (see agent/glossary/volatility.md)."
    kept = sources.relevant(sources.collect(RESULTS), reply)
    assert kept == [   # the conflict check comes first in the results, so its volatility is listed first
        {"label": "TSLA 1-year volatility", "source": "derived from Yahoo chart (unofficial) daily closes",
         "fetchedAt": FETCHED},
        {"label": "TSLA price", "source": "Finnhub", "fetchedAt": FETCHED, "asOf": "2026-11-14T15:29:00.000Z"},
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


def _xray_result():
    figure = lambda v, note: {"value": v, "unit": "%", "source": "derived (xray-v1) from daily closes: TMX Money (delayed 15 min or more)",
                              "fetchedAt": "2026-11-15T09:00:00.000Z", "asOf": "2026-11-13", "note": note}
    return {"figures": {
        "topShare": figure(25, "share"),
        "volatility_last1y": figure(10.37, "vol"),
        "holdings_last1y": [{"symbol": "NVDA", "weight_last1y": figure(15, "w"), "riskShare_last1y": figure(36.97, "r")}],
    }}


def test_xray_figures_are_collected_with_their_window_in_the_label():
    found = sources.collect([{"endpoint": "/api/internal/tools/portfolio-xray", "result": _xray_result()}])
    labels = {item["label"] for item in found}
    assert "volatility (1 year)" in labels
    assert "NVDA share of the risk (1 year)" in labels
    fr = {item["label"] for item in sources.collect([{"endpoint": "x", "result": _xray_result()}], "fr")}
    assert "volatilité (1 an)" in fr and "NVDA part du risque (1 an)" in fr


def test_a_reply_that_states_an_xray_figure_cites_its_source():
    found = sources.collect([{"endpoint": "x", "result": _xray_result()}])
    kept = sources.relevant(found, "NVDA carries 36.97% of the risk with a 15% weight. Volatility is 10.37%.")
    # three figures with one source line and one time are listed once, naming the figures
    assert len(kept) == 1
    assert kept[0]["label"].startswith("X-ray figures (") and "volatility (1 year)" in kept[0]["label"]
    assert kept[0]["source"].startswith("derived (xray-v1)") and kept[0]["fetchedAt"] and kept[0]["asOf"] == "2026-11-13"
    assert sources.relevant(found, "Nothing about the portfolio figures here.") == []


def test_more_than_three_xray_figures_are_counted_and_another_source_is_left_alone():
    figure = lambda v: {"value": v, "unit": "%", "source": "derived (xray-v1) from daily closes: TMX Money",
                        "fetchedAt": "2026-11-15T09:00:00.000Z", "asOf": "2026-11-13"}
    result = {"figures": {"topShare": figure(25), "top3Share": figure(60), "cashShare": figure(30), "volatility_full": figure(14.21)},
              "price": {"value": 356.27, "source": "Finnhub", "fetchedAt": "2026-11-15T09:00:00.000Z"}}
    found = sources.collect([{"endpoint": "x", "result": result}])
    kept = sources.relevant(found, "Largest 25%, top 60%, cash 30%, volatility 14.21%, price 356.27")
    labels = [k["label"] for k in kept]
    assert any(label.startswith("X-ray figures (") and label.endswith(" +1)") for label in labels)
    assert any(k["source"] == "Finnhub" for k in kept) and len(kept) == 2
    fr = sources.relevant(sources.collect([{"endpoint": "x", "result": result}], "fr"), "25 %, 60 %, 30 %", "fr")
    assert fr and fr[0]["label"].startswith("Chiffres de la radiographie (")
