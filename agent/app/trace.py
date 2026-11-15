"""Per-request state: what the tools returned, the model calls made, the proposed action, the log rows."""
import contextvars
import hashlib
import json
import time
from contextlib import contextmanager
from dataclasses import dataclass, field

from . import action_log, config

_current: contextvars.ContextVar["RequestTrace"] = contextvars.ContextVar("request_trace")
_actor: contextvars.ContextVar[str] = contextvars.ContextVar("actor", default="orchestrator")

# Failed rows (each after its one retry) after which a request stops writing to the action log.
MAX_FAILED_LOG_ROWS = 2


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
    conversation_id: str | None = None                   # the web app's conversation id: the memory session
    history_source: str = "request"                      # "memory" when the turns came from AgentCore Memory
    memory_saved: bool = False                           # this turn was stored in AgentCore Memory
    tool_results: list = field(default_factory=list)     # {"endpoint", "result"} for every successful tool call
    model_calls: list = field(default_factory=list)      # the response's modelCalls
    conflict_checks: dict = field(default_factory=dict)  # symbol -> conflict-check result
    validated_rule: dict | None = None
    validated_strategy: dict | None = None               # the last strategy the web app accepted (validate_strategy)
    strategy_refusals: int = 0                           # strategy_propose attempts refused by the web app's schema
    replays: list = field(default_factory=list)          # replay ids run in this request
    proposed: dict | None = None
    log_rows: int = 0
    log_errors: list = field(default_factory=list)
    log_skipped: int = 0                                 # rows not attempted once the log was given up on
    log_table = None                                     # tests pass a fake table
    on_event: object = None                              # set by a streaming request: receives each stage event

    @property
    def locale(self) -> str:
        """The reply language: "en" or "fr", from the context the web app built."""
        return config.locale_of(self.context)

    def log(self, step: str, actor: str | None = None, **fields) -> None:
        """Writes one action-log row, retrying a failed write once. A row that still fails is recorded in
        log_errors (the response then says logComplete: false). Once MAX_FAILED_LOG_ROWS rows of this request
        have failed, the table is taken as unreachable: later rows are counted in log_skipped, not attempted,
        so a request does not spend two timeouts on every row."""
        if self.log_stopped:
            self.log_skipped += 1
            return
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

    def emit(self, stage: str, state: str, name: str | None = None, **fields) -> None:
        """Tells a streaming caller that one stage of this request started or finished. Only names and timings:
        never arguments, results or text. A request that is not streamed has no listener and nothing happens."""
        if self.on_event is not None:
            self.on_event({"type": "stage", "stage": stage, "state": state, **({"name": name} if name else {}), **fields})

    @contextmanager
    def stage(self, stage: str, name: str | None = None):
        """Emits start, then done with the time taken. The caller sets done["ok"] = False for a stage that failed
        without raising; an exception that leaves the block is reported as ok: False and raised again."""
        self.emit(stage, "start", name)
        started = time.monotonic()
        done: dict = {}
        try:
            yield done
        except BaseException:
            self.emit(stage, "done", name, ok=False, ms=int((time.monotonic() - started) * 1000))
            raise
        self.emit(stage, "done", name, **{"ok": True, **done, "ms": int((time.monotonic() - started) * 1000)})

    @property
    def log_stopped(self) -> bool:
        """True once enough rows have failed that further writes for this request are not attempted."""
        return len(self.log_errors) >= MAX_FAILED_LOG_ROWS

    def record_tool(self, endpoint: str, body: dict, result, status: int | None, ms: int) -> None:
        ok = not (isinstance(result, dict) and "error" in result)
        if ok:
            self.tool_results.append({"endpoint": endpoint, "result": result})
        size = len(json.dumps(result, default=str))
        self.emit("tool", "done", endpoint.rsplit("/", 1)[-1], ok=ok, ms=ms)
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
