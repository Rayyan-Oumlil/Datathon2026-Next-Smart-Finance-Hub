"""The wire format: what AgentCore's SDK sends for /invocations, with the model replaced by a script."""
import json

from starlette.testclient import TestClient

from app import main
from tests.test_request import GOOD, PAYLOAD, conflict_then_propose, scripted


def data_lines(response) -> list[dict]:
    return [json.loads(line[len("data: "):]) for line in response.text.splitlines() if line.startswith("data: ")]


def test_stream_flag_gives_server_sent_events(monkeypatch, table, stub):
    scripted(monkeypatch, table, [GOOD], conflict_then_propose)
    with TestClient(main.app) as client:
        response = client.post("/invocations", json={**PAYLOAD, "stream": True})
    assert response.headers["content-type"].startswith("text/event-stream")
    items = data_lines(response)
    assert items[0] == {"type": "stage", "stage": "orchestrator", "state": "start"}
    assert items[-1]["type"] == "final" and items[-1]["reply"]["text"] == GOOD


def test_without_the_flag_it_is_still_plain_json(monkeypatch, table, stub):
    scripted(monkeypatch, table, [GOOD], conflict_then_propose)
    with TestClient(main.app) as client:
        response = client.post("/invocations", json=PAYLOAD)
    assert response.headers["content-type"].startswith("application/json")
    assert response.json()["text"] == GOOD
