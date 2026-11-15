"""AgentCore Memory: the turns are stored and loaded with a fake client, and memory never breaks a reply."""
from datetime import datetime

import pytest

from app import main, memory, orchestrator

from .test_request import PAYLOAD, scripted


class FakeMemory:
    """Keeps events per (actor, session) like AgentCore Memory, returned newest first to check the sort."""

    def __init__(self, fail=False):
        self.events, self.fail, self.created, self.listed = {}, fail, [], []

    def create_event(self, **kwargs):
        if self.fail:
            raise RuntimeError("memory down")
        self.created.append(kwargs)
        key = (kwargs["actorId"], kwargs["sessionId"])
        self.events.setdefault(key, []).append({"eventTimestamp": kwargs["eventTimestamp"], "payload": kwargs["payload"]})
        return {"event": {"eventId": str(len(self.created))}}

    def list_events(self, **kwargs):
        self.listed.append(kwargs)
        if self.fail:
            raise RuntimeError("memory down")
        return {"events": list(reversed(self.events.get((kwargs["actorId"], kwargs["sessionId"]), [])))}


def with_memory(monkeypatch, client, memory_id="datathon_agent_memory-abcdefghij"):
    monkeypatch.setenv("MEMORY_ID", memory_id)
    monkeypatch.setattr(memory, "_client", lambda: client)


def test_off_without_memory_id(monkeypatch):
    monkeypatch.delenv("MEMORY_ID", raising=False)
    client = FakeMemory()
    monkeypatch.setattr(memory, "_client", lambda: client)
    assert memory.load_history("u1", "c1") is None
    assert memory.save_turn("u1", "c1", "hi", "hello") is False
    assert client.created == [] and client.listed == []


def test_saves_the_message_and_reply_as_one_event_and_loads_them_back_in_order(monkeypatch):
    client = FakeMemory()
    with_memory(monkeypatch, client)
    for i in range(7):
        assert memory.save_turn("sess:p0:f0", "c1", f"question {i}", f"answer {i}", f"act_{i}")
    stored = client.created[0]
    assert stored["actorId"] == "sess:p0:f0" and stored["sessionId"].startswith("conv-")
    assert [p["conversational"]["role"] for p in stored["payload"]] == ["USER", "ASSISTANT"]
    assert isinstance(stored["eventTimestamp"], datetime) and stored["clientToken"]
    loaded = memory.load_history("sess:p0:f0", "c1")
    # The last five turns, oldest first, whatever order the service lists them in
    assert loaded[0] == {"role": "user", "text": "question 2"} and loaded[-1] == {"role": "assistant", "text": "answer 6"}
    assert len(loaded) == 10


def test_a_new_conversation_or_a_reset_profile_starts_a_new_session():
    assert memory.session_id("s:p0:f0", "c1") != memory.session_id("s:p0:f0", "c2")
    assert memory.session_id("s:p0:f0", "c1") != memory.session_id("s:p1:f0", "c1")      # profile reset
    assert memory.session_id("s:p0:f0", "c1") == memory.session_id("s:p0:f0", "c1")
    assert memory.actor_id("bad id!") == "bad-id-" and memory.actor_id("") == "anonymous"


def test_failures_fall_back_and_never_raise(monkeypatch):
    with_memory(monkeypatch, FakeMemory(fail=True))
    assert memory.load_history("u1", "c1") is None
    assert memory.save_turn("u1", "c1", "hi", "hello") is False


def test_a_request_uses_the_remembered_turns_and_stores_its_checked_reply(monkeypatch, table, stub):
    client = FakeMemory()
    with_memory(monkeypatch, client)
    memory.save_turn("demo-user", "conv-1", "earlier question", "earlier answer")
    seen = {}
    real_build = orchestrator.history_messages

    def build(current):
        seen["history"] = list(current.history)
        seen["messages"] = real_build(current.history)

    scripted(monkeypatch, table, ["Hello."])
    monkeypatch.setattr(orchestrator, "build", build)
    reply = main.invoke({**PAYLOAD, "message": "hi", "conversationId": "conv-1",
                         "history": [{"role": "user", "text": "from the request"}, {"role": "assistant", "text": "x"}]})
    assert reply["refused"] is False and reply["trace"]["history"] == "memory" and reply["trace"]["memorySaved"]
    assert seen["history"] == [{"role": "user", "text": "earlier question"}, {"role": "assistant", "text": "earlier answer"}]
    last = client.created[-1]["payload"]
    assert last[0]["conversational"]["content"]["text"] == "hi"
    assert last[1]["conversational"]["content"]["text"] == "Hello."
    # Only the message and the reply: nothing from the tools or the context
    assert len(last) == 2


def test_a_memory_failure_keeps_the_request_history(monkeypatch, table, stub):
    with_memory(monkeypatch, FakeMemory(fail=True))
    seen = {}
    scripted(monkeypatch, table, ["Hello."])
    monkeypatch.setattr(orchestrator, "build", lambda current: seen.setdefault("history", list(current.history)))
    reply = main.invoke({**PAYLOAD, "message": "hi", "conversationId": "conv-1"})
    assert reply["refused"] is False and reply["text"] == "Hello."
    assert reply["trace"]["history"] == "request" and reply["trace"]["memorySaved"] is False
    assert seen["history"] == PAYLOAD["history"]


def test_conversation_id_is_checked():
    with pytest.raises(ValueError):
        main.parse_request({**PAYLOAD, "conversationId": 7})
    assert main.parse_request({**PAYLOAD, "conversationId": "c-1"}).conversation_id == "c-1"


def test_preferences_are_read_only_when_turned_on(monkeypatch):
    class Records(FakeMemory):
        def retrieve_memory_records(self, **kwargs):
            self.query = kwargs
            return {"memoryRecordSummaries": [{"content": {"text": "Prefers a simpler page"}}]}

    client = Records()
    with_memory(monkeypatch, client)
    monkeypatch.delenv("MEMORY_PREFERENCES", raising=False)
    assert memory.load_preferences("u1", "hide things") == []
    monkeypatch.setenv("MEMORY_PREFERENCES", "1")
    assert memory.load_preferences("u1", "hide things") == ["Prefers a simpler page"]
    assert client.query["namespace"] == "/users/u1/preferences"

