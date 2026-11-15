"""Append-only writer for the agent_action_log table. Plain code: no model ever writes a row.

There is no update or delete path in this module. Each row is a PutItem with
attribute_not_exists(id), so an existing row can never be overwritten.
"""
import json
import secrets
import sys
from datetime import datetime, timezone
from decimal import Decimal

import boto3
from botocore.config import Config

from . import config

_table = None


def table():
    global _table
    if _table is None:
        resource = boto3.resource(
            "dynamodb",
            region_name=config.region(),
            endpoint_url=config.env("DYNAMODB_ENDPOINT") or None,
            config=Config(connect_timeout=2, read_timeout=3, retries={"max_attempts": 2}),
        )
        _table = resource.Table(config.env("AGENT_ACTION_LOG_TABLE", "agent_action_log"))
    return _table


def new_row_id(now: datetime | None = None) -> tuple[str, str]:
    """Returns (id, at): id is the ISO time + '#' + 8 hex characters."""
    at = (now or datetime.now(timezone.utc)).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    return f"{at}#{secrets.token_hex(4)}", at


def build_row(user_id: str, action_id: str, step: str, actor: str, **fields) -> dict:
    row_id, at = new_row_id()
    row = {"userId": user_id, "id": row_id, "at": at, "actionId": action_id, "step": step, "actor": actor}
    row.update({k: v for k, v in fields.items() if v is not None})
    return row


def write(row: dict, tbl=None) -> str | None:
    """Puts one row. Returns None on success, or a short error text. Never raises."""
    try:
        item = json.loads(json.dumps(row, default=str), parse_float=Decimal)  # DynamoDB has no float type
        (tbl or table()).put_item(Item=item, ConditionExpression="attribute_not_exists(id)")
        return None
    except Exception as exc:  # the request must survive an unreachable table
        error = f"{type(exc).__name__}: {str(exc)[:200]}"
        print(f"action log write failed ({row.get('step')}): {error}", file=sys.stderr)
        return error
