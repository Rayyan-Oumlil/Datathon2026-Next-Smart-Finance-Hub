"""Per-request state: what the tools returned, the model calls made, the proposed action, the log rows."""
import contextvars
import hashlib
import json
from dataclasses import dataclass, field

from . import action_log, config

_current: contextvars.ContextVar["RequestTrace"] = contextvars.ContextVar("request_trace")
_actor: contextvars.ContextVar[str] = contextvars.ContextVar("actor", default="orchestrator")


def sha256(value) -> str:
    text = value if isinstance(value, str) else json.dumps(value, sort_keys=True, default=str)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


@dataclass
class RequestTrace:
    action_id: str
    user_id: str
    message: str
    context: dict
    history: list = field(default_factory=list)
    tool_results: list = field(default_factory=list)     # {"endpoint", "result"} for every successful tool call
    model_calls: list = field(default_factory=list)      # the response's modelCalls
    conflict_checks: dict = field(default_factory=dict)  # symbol -> conflict-check result
    validated_rule: dict | None = None
    proposed: dict | None = None
    log_rows: int = 0
    log_errors: list = field(default_factory=list)
    log_table = None                                     # tests pass a fake table

    def log(self, step: str, actor: str | None = None, **fields) -> None:
        """Writes one action-log row, retrying a failed write once. A row that still fails is recorded in
        log_errors (the response then says logComplete: false) and the next rows are still tried."""
        row = action_log.build_row(self.user_id, self.action_id, step, actor or current_actor(),
                                   promptVersion=config.PROMPT_VERSION, **fields)
        first = action_log.write(row, self.log_table)
        error = first
        if first:
            # Same row id: if the first put did land, the append-only condition refuses the second one.
            error = action_log.write(row, self.log_table)
            if error and "ConditionalCheckFailed" in error and "ConditionalCheckFailed" not in first:
                error = None
        if error:
            self.log_errors.append(error)
        else:
            self.log_rows += 1

    def record_tool(self, endpoint: str, body: dict, result, status: int | None, ms: int) -> None:
        ok = not (isinstance(result, dict) and "error" in result)
        if ok:
            self.tool_results.append({"endpoint": endpoint, "result": result})
        size = len(json.dumps(result, default=str))
        self.log("tool_call" if ok else "error", dataUsed={"endpoint": endpoint, "body": body},
                 result={"status": status, "ok": ok, "sha256": sha256(result), "bytes": size, "ms": ms,
                         **({} if ok else {"error": str(result.get("error"))[:200]})})


def start(trace: RequestTrace) -> contextvars.Token:
    return _current.set(trace)


def current() -> RequestTrace:
    return _current.get()


def current_or_none() -> RequestTrace | None:
    return _current.get(None)


def current_actor() -> str:
    return _actor.get()


def set_actor(name: str) -> contextvars.Token:
    return _actor.set(name)


def reset_actor(token: contextvars.Token) -> None:
    _actor.reset(token)
