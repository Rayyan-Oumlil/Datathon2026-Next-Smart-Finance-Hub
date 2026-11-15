"""Conversation memory on Amazon Bedrock AgentCore Memory (short-term events, and an optional long-term
user-preference strategy). Set MEMORY_ID to the memory created by infra/agent-memory.sh; without it nothing here
calls AWS and the request's own history is used, as before.

What is stored: per request, one event holding two messages, the user's message and the reply the user was shown
(after every check). Never tool results, figures fetched for the reply, context or prompts.
Actor: the web user id the request carries (the visitor's scope id, which changes when the profile is reset).
Session: the conversation id the web app sends, combined with the actor, so a reset (a new scope id, and the panel's
new conversation id) always starts a new memory session.

Memory must never break a reply: every call has short timeouts, and any failure falls back to the request's history
(when loading) or is only logged (when saving).
"""
import hashlib
import re
import sys
from datetime import datetime, timezone
from functools import lru_cache

from . import config

MAX_TURNS = 5                    # turns loaded at the start of a request (a turn is one user message and its reply)
MAX_MESSAGE_CHARS = 4000         # a stored message is cut to this length
MAX_PREFERENCES = 3              # long-term preference records added to the context
_ACTOR_CHARS = re.compile(r"[^a-zA-Z0-9\-_/:]")


def memory_id() -> str:
    return config.env("MEMORY_ID")


def enabled() -> bool:
    return bool(memory_id())


@lru_cache(maxsize=1)
def _client():
    import boto3
    from botocore.config import Config
    return boto3.client("bedrock-agentcore", region_name=config.region(), config=Config(
        connect_timeout=2, read_timeout=4, retries={"max_attempts": 2, "mode": "standard"}))


def actor_id(user_id: str) -> str:
    """The web user id in the form AgentCore accepts (letters, digits, - _ / and : separators)."""
    cleaned = _ACTOR_CHARS.sub("-", user_id or "").strip(":") or "anonymous"
    if not cleaned[0].isalnum():
        cleaned = "u" + cleaned
    return cleaned[:255]


def session_id(user_id: str, conversation_id: str | None) -> str:
    """One memory session per user and conversation; a new scope id (profile reset) gives a new session."""
    digest = hashlib.sha256(f"{user_id}|{conversation_id or 'default'}".encode("utf-8")).hexdigest()
    return f"conv-{digest[:48]}"


def _messages(event: dict) -> list[dict]:
    out = []
    for item in event.get("payload") or []:
        conversational = item.get("conversational") if isinstance(item, dict) else None
        if not conversational:
            continue
        role = {"USER": "user", "ASSISTANT": "assistant"}.get(conversational.get("role"))
        text = (conversational.get("content") or {}).get("text")
        if role and isinstance(text, str) and text.strip():
            out.append({"role": role, "text": text})
    return out


def _timestamp(event: dict) -> float:
    value = event.get("eventTimestamp")
    if isinstance(value, datetime):
        return value.timestamp()
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def load_history(user_id: str, conversation_id: str | None, client=None) -> list[dict] | None:
    """The last turns of this conversation as [{role, text}], oldest first. None when memory is off or the call
    failed: the caller then uses the history in the request."""
    if not enabled():
        return None
    try:
        response = (client or _client()).list_events(
            memoryId=memory_id(), actorId=actor_id(user_id), sessionId=session_id(user_id, conversation_id),
            includePayloads=True, maxResults=min(100, MAX_TURNS * 4))
        events = sorted(response.get("events") or [], key=_timestamp)
        turns = [_messages(event) for event in events]
        return [message for turn in turns[-MAX_TURNS:] for message in turn]
    except Exception as exc:  # memory never breaks a reply
        print(f"memory: load failed, using the request's history ({type(exc).__name__}: {str(exc)[:200]})",
              file=sys.stderr)
        return None


def save_turn(user_id: str, conversation_id: str | None, message: str, reply: str, action_id: str = "",
              client=None) -> bool:
    """Records the user's message and the reply the user was shown, as one event. Returns True when stored."""
    if not enabled() or not message.strip() or not reply.strip():
        return False
    try:
        (client or _client()).create_event(
            memoryId=memory_id(), actorId=actor_id(user_id), sessionId=session_id(user_id, conversation_id),
            eventTimestamp=datetime.now(timezone.utc),
            payload=[
                {"conversational": {"role": "USER", "content": {"text": message[:MAX_MESSAGE_CHARS]}}},
                {"conversational": {"role": "ASSISTANT", "content": {"text": reply[:MAX_MESSAGE_CHARS]}}},
            ],
            **({"clientToken": hashlib.sha256(action_id.encode()).hexdigest()[:64]} if action_id else {}),
        )
        return True
    except Exception as exc:  # memory never breaks a reply
        print(f"memory: save failed ({type(exc).__name__}: {str(exc)[:200]})", file=sys.stderr)
        return False


def preferences_namespace(user_id: str) -> str:
    """Where infra/agent-memory.sh's user-preference strategy writes this actor's records."""
    return f"/users/{actor_id(user_id)}/preferences"


def load_preferences(user_id: str, query: str, client=None) -> list[str]:
    """Long-term preferences extracted from earlier conversations (layout and display wishes, language...), when
    MEMORY_PREFERENCES is on. An empty list on any failure."""
    if not enabled() or config.env("MEMORY_PREFERENCES") not in ("1", "true", "on"):
        return []
    try:
        response = (client or _client()).retrieve_memory_records(
            memoryId=memory_id(), namespace=preferences_namespace(user_id),
            searchCriteria={"searchQuery": query[:500] or "preferences", "topK": MAX_PREFERENCES},
            maxResults=MAX_PREFERENCES)
        found = []
        for record in response.get("memoryRecordSummaries") or []:
            text = (record.get("content") or {}).get("text")
            if isinstance(text, str) and text.strip():
                found.append(text.strip()[:300])
        return found[:MAX_PREFERENCES]
    except Exception as exc:
        print(f"memory: preferences unavailable ({type(exc).__name__}: {str(exc)[:200]})", file=sys.stderr)
        return []
