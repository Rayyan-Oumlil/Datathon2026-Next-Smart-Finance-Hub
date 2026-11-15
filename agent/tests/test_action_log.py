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
        calls = 0

        def put_item(self, **_):
            Broken.calls += 1
            raise ConnectionError("table unreachable")

    request = trace.RequestTrace(action_id="act_1", user_id="u", message="m", context={})
    request.log_table = Broken()
    request.log("prompt_built", "writer")
    request.log("tool_call", "writer")            # later rows are still tried after a failure
    assert Broken.calls == 4                      # each row: one write and one retry
    assert request.log_rows == 0 and len(request.log_errors) == 2
    assert "table unreachable" in request.log_errors[0]
    assert "action log write failed" in capsys.readouterr().err


def test_writes_stop_after_two_failed_rows(capsys):
    class Broken:
        calls = 0

        def put_item(self, **_):
            Broken.calls += 1
            raise ConnectionError("table unreachable")

    request = trace.RequestTrace(action_id="act_1", user_id="u", message="m", context={})
    request.log_table = Broken()
    request.log("prompt_built", "writer")
    assert not request.log_stopped                # one failed row: the next one is still tried
    request.log("tool_call", "writer")
    assert request.log_stopped and Broken.calls == 4
    request.log("tool_call", "writer")
    request.log("guardrail_check", "writer")
    assert Broken.calls == 4                      # no further attempt, so no further timeouts
    assert request.log_rows == 0 and len(request.log_errors) == 2 and request.log_skipped == 2


def test_failed_rows_count_across_the_request_not_in_a_row(table):
    class Alternating:
        calls = 0

        def put_item(self, **kwargs):
            Alternating.calls += 1
            if Alternating.calls in (1, 2, 4, 5):  # rows 1 and 3 fail twice; row 2 is written
                raise ConnectionError("timeout")
            table.put_item(**kwargs)

    request = trace.RequestTrace(action_id="act_1", user_id="u", message="m", context={})
    request.log_table = Alternating()
    for step in ("prompt_built", "tool_call", "tool_call", "guardrail_check"):
        request.log(step, "writer")
    # Two rows failed in the request (not in a row), so the fourth one is skipped
    assert request.log_rows == 1 and len(request.log_errors) == 2 and request.log_skipped == 1


def test_a_failed_write_is_retried_once(table):
    class Flaky:
        failures = 1

        def put_item(self, **kwargs):
            if Flaky.failures:
                Flaky.failures -= 1
                raise ConnectionError("timeout")
            table.put_item(**kwargs)

    request = trace.RequestTrace(action_id="act_1", user_id="u", message="m", context={})
    request.log_table = Flaky()
    request.log("prompt_built", "writer")
    request.log("tool_call", "writer")
    assert request.log_rows == 2 and request.log_errors == [] and len(table.items) == 2


def test_a_retry_refused_because_the_first_put_landed_counts_as_written(table):
    class LostReply:
        def put_item(self, **kwargs):
            if not table.calls:
                table.put_item(**kwargs)          # the row is written, but the answer is lost
                raise ConnectionError("read timeout")
            table.put_item(**kwargs)

    request = trace.RequestTrace(action_id="act_1", user_id="u", message="m", context={})
    request.log_table = LostReply()
    request.log("prompt_built", "writer")
    assert request.log_rows == 1 and request.log_errors == [] and len(table.items) == 1
