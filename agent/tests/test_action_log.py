import re
from decimal import Decimal

from app import action_log, trace


def test_row_shape_and_append_only_condition(table):
    row = action_log.build_row("demo-user", "act_1", "orchestrator_call", "orchestrator", modelId="m",
                               awsRequestId="req-1", inputTokens=10, outputTokens=5,
                               promptSha256="a" * 64, replySha256="b" * 64, statedReason=None)
    assert action_log.write(row, table) is None
    call = table.calls[0]
    assert call["ConditionExpression"] == "attribute_not_exists(id)"
    item = call["Item"]
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z#[0-9a-f]{8}", item["id"])
    assert item["id"].split("#")[0] == item["at"]
    assert {"userId": "demo-user", "actionId": "act_1", "step": "orchestrator_call", "actor": "orchestrator",
            "modelId": "m", "awsRequestId": "req-1", "inputTokens": 10, "outputTokens": 5}.items() <= item.items()
    assert "statedReason" not in item          # empty fields are left out


def test_floats_are_stored_as_decimals(table):
    action_log.write(action_log.build_row("u", "a", "tool_call", "writer", result={"ms": 1.5}), table)
    assert table.calls[0]["Item"]["result"]["ms"] == Decimal("1.5")


def test_an_existing_row_is_never_overwritten(table):
    row = action_log.build_row("u", "a", "error", "writer")
    assert action_log.write(row, table) is None
    error = action_log.write({**row, "step": "changed"}, table)
    assert "ConditionalCheckFailed" in error
    assert table.items[("u", row["id"])]["step"] == "error"


def test_the_writer_has_no_update_or_delete_path():
    source = open(action_log.__file__, encoding="utf-8").read()
    assert "update_item" not in source and "delete_item" not in source and "batch_write" not in source


def test_unreachable_table_does_not_raise_and_is_recorded(capsys):
    class Broken:
        def put_item(self, **_):
            raise ConnectionError("table unreachable")

    request = trace.RequestTrace(action_id="act_1", user_id="u", message="m", context={})
    request.log_table = Broken()
    request.log("prompt_built", "writer")
    request.log("tool_call", "writer")            # no second attempt after a failure
    assert request.log_rows == 0 and len(request.log_errors) == 1
    assert "table unreachable" in request.log_errors[0]
    assert "action log write failed" in capsys.readouterr().err
