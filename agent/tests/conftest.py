import os

import pytest

# Unit tests never reach AWS or the real table.
os.environ["GUARDRAIL_ID"] = ""
os.environ["MEMORY_ID"] = ""
os.environ["MEMORY_PREFERENCES"] = ""
os.environ["AWS_EC2_METADATA_DISABLED"] = "true"

from app import trace  # noqa: E402
from tests.stub_web import TOKEN, StubWeb  # noqa: E402


class FakeTable:
    """Accepts PutItem only, and refuses a row whose id already exists, like the real condition."""

    def __init__(self):
        self.items = {}
        self.calls = []

    def put_item(self, **kwargs):
        self.calls.append(kwargs)
        item = kwargs["Item"]
        key = (item["userId"], item["id"])
        if kwargs.get("ConditionExpression") == "attribute_not_exists(id)" and key in self.items:
            raise RuntimeError("ConditionalCheckFailedException")
        self.items[key] = item


@pytest.fixture
def table():
    return FakeTable()


@pytest.fixture
def stub(monkeypatch):
    server = StubWeb()
    monkeypatch.setenv("WEB_INTERNAL_URL", server.url)
    monkeypatch.setenv("INTERNAL_API_TOKEN", TOKEN)
    yield server
    server.close()


@pytest.fixture
def current(table):
    """A request trace bound to the fake table, set as the current request."""
    request = trace.RequestTrace(action_id="act_test", user_id="demo-user", message="hello",
                                 context={"level": "Novice", "risk": "Low", "agentStyle": "teach me"})
    request.log_table = table
    token = trace.start(request)
    yield request
    trace._current.reset(token)
