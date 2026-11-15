"""One agent request as a stream of events. The request runs in a worker thread and pushes stage events into a
queue; this generator yields them as they come, plus a heartbeat while nothing happens (a load balancer drops a
connection that stays silent for its idle timeout, 60 s by default), then the reply or an error.

AgentCore turns a generator returned by the entrypoint into text/event-stream, one `data:` line per event."""
import contextvars
import queue
import threading
from collections.abc import Callable, Iterator

HEARTBEAT_SECONDS = 10.0
_DONE = object()


def events(payload, handle: Callable, heartbeat: float = HEARTBEAT_SECONDS) -> Iterator[dict]:
    """handle(payload, on_event) -> reply dict. Yields stage events, heartbeats, then {"type": "final", "reply"}
    or {"type": "error", "message"}."""
    inbox: queue.Queue = queue.Queue()

    def work() -> None:
        try:
            inbox.put({"type": "final", "reply": handle(payload, inbox.put)})
        except Exception as exc:  # handle() answers its own failures; this is a bug, reported and never hidden
            inbox.put({"type": "error", "message": f"{type(exc).__name__}: {str(exc)[:300]}"})
        finally:
            inbox.put(_DONE)

    threading.Thread(target=contextvars.copy_context().run, args=(work,), daemon=True).start()
    while True:
        try:
            item = inbox.get(timeout=heartbeat)
        except queue.Empty:
            yield {"type": "heartbeat"}
            continue
        if item is _DONE:
            return
        yield item
