"""The streaming reply: stage events while the request runs, a heartbeat when it is quiet, then the same reply."""
import time
from types import SimpleNamespace

from app import main, orchestrator, stream, subagents, trace
from tests.test_request import GOOD, PAYLOAD, conflict_then_propose, scripted


def events(payload=PAYLOAD):
    return list(main.invoke({**payload, "stream": True}))


def stages(items):
    return [(e["stage"], e.get("name"), e["state"]) for e in items if e["type"] == "stage"]


def test_without_the_flag_the_reply_is_still_one_dict(monkeypatch, table, stub):
    scripted(monkeypatch, table, [GOOD], conflict_then_propose)
    assert isinstance(main.invoke(PAYLOAD), dict)


def test_stream_ends_with_the_same_reply_body(monkeypatch, table, stub):
    scripted(monkeypatch, table, [GOOD], conflict_then_propose)
    plain = main.invoke(PAYLOAD)
    scripted(monkeypatch, table, [GOOD], conflict_then_propose)
    items = events()
    assert items[-1]["type"] == "final"
    reply = items[-1]["reply"]
    assert set(reply) == set(plain) and reply["text"] == GOOD and reply["proposed"] == plain["proposed"]
    assert [e["type"] for e in items[:-1]] == ["stage"] * (len(items) - 1)


def test_stages_come_in_order(monkeypatch, table, stub):
    scripted(monkeypatch, table, [GOOD], conflict_then_propose)
    items = events()
    seen = stages(items)
    assert seen[0] == ("orchestrator", None, "start")
    tool = next(e for e in items if e["type"] == "stage" and e["stage"] == "tool" and e["state"] == "done")
    assert tool["name"] == "conflict-check" and tool["state"] == "done" and tool["ok"] is True and "ms" in tool
    assert seen.index(("orchestrator", None, "done")) < seen.index(("guardrail", None, "start"))
    guardrail = [e for e in items if e["type"] == "stage" and e["stage"] == "guardrail" and e["state"] == "done"]
    assert guardrail[0]["attempt"] == 1 and guardrail[0]["passed"] is True


def test_a_failed_check_shows_the_retry(monkeypatch, table, stub):
    scripted(monkeypatch, table, ["You should buy it at $9,999.", GOOD], conflict_then_propose)
    items = events()
    done = [e for e in items if e["type"] == "stage" and e["stage"] == "guardrail" and e["state"] == "done"]
    assert [e["passed"] for e in done] == [False, True]
    seen = stages(items)
    assert ("retry", None, "start") in seen
    assert seen.index(("guardrail", None, "start")) < seen.index(("retry", None, "start"))


def test_a_subagent_reports_start_and_done(monkeypatch, table, stub):
    class FakeAgent:
        def __init__(self, **_):
            pass

        def __call__(self, task):
            return SimpleNamespace(message={"content": [{"text": "FACT: ok"}]})

    monkeypatch.setattr(subagents, "Agent", FakeAgent)
    scripted(monkeypatch, table, [GOOD], lambda current: subagents.run_subagent("market_data", "TSLA"))
    items = events()
    mine = [e for e in items if e["type"] == "stage" and e["stage"] == "subagent"]
    assert [(e["name"], e["state"]) for e in mine] == [("market_data", "start"), ("market_data", "done")]
    assert mine[1]["ok"] is True and "ms" in mine[1]


def test_a_failing_subagent_reports_ok_false(monkeypatch, table, stub):
    class BrokenAgent:
        def __init__(self, **_):
            pass

        def __call__(self, task):
            raise RuntimeError("ThrottlingException")

    monkeypatch.setattr(subagents, "Agent", BrokenAgent)
    scripted(monkeypatch, table, [GOOD], lambda current: subagents.run_subagent("portfolio", "x"))
    done = [e for e in events() if e["type"] == "stage" and e.get("name") == "portfolio" and e["state"] == "done"]
    assert done and done[0]["ok"] is False


def test_a_quiet_request_sends_heartbeats_then_the_reply():
    def slow(payload, on_event):
        time.sleep(0.35)
        return {"text": "done"}

    items = list(stream.events({}, slow, heartbeat=0.05))
    assert sum(e["type"] == "heartbeat" for e in items) >= 3
    assert items[-1] == {"type": "final", "reply": {"text": "done"}}


def test_an_unexpected_failure_ends_with_an_error_event():
    def broken(payload, on_event):
        raise KeyError("boom")

    items = list(stream.events({}, broken, heartbeat=0.05))
    assert items[-1]["type"] == "error" and "KeyError" in items[-1]["message"] and len(items) == 1


def test_a_malformed_streaming_request_ends_with_the_refusal_and_no_model_call():
    items = list(main.invoke({**PAYLOAD, "message": "", "stream": True}))
    assert items[-1]["type"] == "final"
    reply = items[-1]["reply"]
    assert reply["error"] == "invalid_request" and reply["refused"] is True and reply["modelCalls"] == []


def test_the_trace_does_not_leak_out_of_the_worker(monkeypatch, table, stub):
    scripted(monkeypatch, table, [GOOD], conflict_then_propose)
    events()
    assert trace.current_or_none() is None
    assert orchestrator.ask is not None
