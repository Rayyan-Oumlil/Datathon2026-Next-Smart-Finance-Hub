import httpx

from app import orchestrator, web_tools
from tests.stub_web import TSLA


def test_headers_body_and_unchanged_json(stub, current, table):
    result = web_tools.call_web("market-data", {"symbols": ["TSLA"]})
    assert result == {"items": [TSLA]}                      # the web app's JSON, unchanged
    request = stub.requests[0]
    assert request["path"] == "/api/internal/tools/market-data"
    assert request["headers"]["x-internal-token"] == "stub-token"
    assert request["headers"]["x-action-id"] == "act_test"
    assert request["body"] == {"symbols": ["TSLA"], "userId": "demo-user"}
    assert current.tool_results == [{"endpoint": "/api/internal/tools/market-data", "result": result}]
    row = list(table.items.values())[0]
    assert row["step"] == "tool_call" and row["actionId"] == "act_test"
    assert row["result"]["status"] == 200 and len(row["result"]["sha256"]) == 64
    assert "items" not in str(row["result"])                # a hash and a size, not the data


def test_each_tool_posts_to_its_endpoint(stub, current):
    web_tools.get_market_data(symbols=["AAPL"])
    web_tools.explain_pick(symbol="ENB")
    web_tools.get_portfolio()
    web_tools.get_portfolio_stats(metric="drawdown", period="3m")
    web_tools.validate_rule(text="t", symbol="AAPL", trigger_type="price_below", trigger_value=200,
                            side="buy", quantity=2)
    web_tools.list_rules()
    web_tools.get_layout()
    web_tools.preview_profile_change(changes={"risk": "High"})
    orchestrator.check_profile_conflict(symbol="tsla")
    assert [r["path"].rsplit("/", 1)[-1] for r in stub.requests] == [
        "market-data", "explain-pick", "portfolio", "portfolio-stats", "validate-rule", "rules", "layout",
        "profile-preview", "conflict-check"]
    assert stub.requests[4]["body"]["rule"] == {
        "text": "t", "symbol": "AAPL", "trigger": {"type": "price_below", "value": 200},
        "action": {"side": "buy", "quantity": 2}, "once": True}
    assert current.validated_rule["id"] == "rule_stub1"
    assert current.conflict_checks["TSLA"]["conflicts"][0]["filter"] == "volatility"


def test_http_error_is_returned_not_raised(stub, current, table):
    result = web_tools.call_web("no-such-tool")
    assert result == {"error": "HTTP 404", "endpoint": "/api/internal/tools/no-such-tool"}
    assert current.tool_results == []                       # an error is not data
    assert list(table.items.values())[0]["step"] == "error"


def test_wrong_token_is_reported(stub, current, monkeypatch):
    monkeypatch.setenv("INTERNAL_API_TOKEN", "wrong")
    assert web_tools.call_web("portfolio")["error"] == "HTTP 401"


def test_invalid_json_and_unreachable_host(stub, current, monkeypatch):
    assert web_tools.call_web("broken")["error"] == "JSONDecodeError"
    monkeypatch.setenv("WEB_INTERNAL_URL", "http://127.0.0.1:9")
    assert web_tools.call_web("portfolio")["error"] in ("ConnectError", "ConnectTimeout")


def test_timeout_is_returned_not_raised(current, monkeypatch):
    def slow(*args, **kwargs):
        raise httpx.ReadTimeout("slow")

    monkeypatch.setattr(web_tools._client(), "post", slow)
    assert web_tools.call_web("portfolio") == {"error": "ReadTimeout", "endpoint": "/api/internal/tools/portfolio"}


def test_glossary_reads_the_local_files(current):
    result = web_tools.search_glossary(query="What is an ETF?")
    top = result["documents"][0]
    assert top["location"] == "agent/glossary/etf.md" and top["text"].startswith("# ETF")
    assert web_tools.search_glossary(query="zzzz")["documents"] == []
