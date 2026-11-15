"""strategy_propose on the agent side: the web app's schema decides, its issue codes come back for one correction,
and the replay digest's figures count as grounded (they are tool results)."""
from app import checks, orchestrator, web_tools

GOOD = {"name": "Prudente", "rules": [{"kind": "allocation_target", "targets": [{"symbol": "XIU.TO", "weightPct": 60}],
                                       "rebalance": {"mode": "quarterly"}}]}


def test_a_refused_strategy_returns_its_issue_codes_and_records_nothing(stub, current):
    note = orchestrator.record_proposal(current, "strategy_propose", "s", {"strategy": {**GOOD, "colour": "red"}})
    assert note.startswith("Not recorded") and "unknown_field at colour" in note
    assert current.proposed is None and current.strategy_refusals == 1


def test_a_second_refusal_stops_further_attempts(stub, current):
    bad = {"strategy": {"rules": []}}
    orchestrator.record_proposal(current, "strategy_propose", "s", bad)
    orchestrator.record_proposal(current, "strategy_propose", "s", bad)
    note = orchestrator.record_proposal(current, "strategy_propose", "s", {"strategy": GOOD})
    assert "refused twice" in note and current.proposed is None


def test_a_valid_strategy_is_recorded_as_the_app_normalised_it(stub, current):
    note = orchestrator.record_proposal(current, "strategy_propose", "s", {"strategy": GOOD, "replaceId": "strat_1"})
    assert note.startswith("Recorded")
    params = current.proposed["params"]
    assert params["strategy"]["rules"][0]["id"] == "allocation_target_1" and params["replaceId"] == "strat_1"
    assert current.proposed["needsConfirm"] is True


def test_run_replay_posts_to_the_replay_tool_and_refuses_bad_input_without_a_call(stub, current):
    result = web_tools.run_replay._tool_func(portfolio="current", strategy=GOOD)
    assert result["replayId"] == "rpl_stub" and current.replays == ["rpl_stub"]
    assert stub.requests[-1]["path"].endswith("/replay") and stub.requests[-1]["body"]["strategy"] == GOOD
    count = len(stub.requests)
    assert "error" in web_tools.run_replay._tool_func(portfolio="someone")
    assert "error" in web_tools.run_replay._tool_func(strategy=GOOD, strategy_id="strat_1")
    assert len(stub.requests) == count


def test_digest_figures_are_grounded_in_both_languages(stub, current):
    web_tools.run_replay._tool_func()
    data = [current.tool_results, current.context, None]
    fr = "Sans règles : 13 456,78 $, rendement total 34,6 %, repli maximal 18,2 %. Avec la stratégie : 12 987,65 $, 29,9 %, repli maximal 12,3 %, volatilité 7,7 %."
    en = "Without rules: $13,456.78, total return 34.6%, largest fall 18.2%; with the strategy: 29.9%, largest fall 12.3%."
    assert checks.ungrounded_numbers(fr, data, "fr") == []
    assert checks.ungrounded_numbers(en, data, "en") == []
    assert checks.ungrounded_numbers("Avec la stratégie : 41,0 %.", data, "fr") == ["41,0 %"]
