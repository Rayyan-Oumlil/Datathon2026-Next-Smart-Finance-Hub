"""Prompt templates: one file per agent under prompts/, filled here. Any change bumps config.PROMPT_VERSION."""
import json
from functools import lru_cache
from pathlib import Path

from . import checks, config

PROMPT_DIR = Path(__file__).parent / "prompts"

LEVEL_TONE = {
    "Novice": "Plain everyday words, short sentences, at most about 90 words. Few figures: only the ones "
              "that answer the question. Avoid jargon; a term that cannot be avoided is explained by the glossary.",
    "Intermediate": "Clear and compact, at most about 150 words. Give the key figures that answer the question.",
    "Expert": "Dense. Raw values with units, source and fetch time inline, rule versions when given. "
              "No definitions of common terms.",
}
STYLE_TONE = {
    "teach me": "Teaching style: when a term needs explaining, ask the glossary specialist and use its words; "
                "when a tool returns a method or a detail for a figure, include it.",
    "suggest": "Pointer style: end with one thing in the app the user can look at next (a card, the Why? panel, "
               "a glossary term). A pointer is never a pick or an opinion on an asset.",
    "just the data": "Data style: figures and sources only, no commentary.",
}

# The slice of the context each subagent receives.
CONTEXT_SLICE = {
    "market_data": ["level"],
    "watchlist_explainer": ["level", "risk", "watchlist"],
    "portfolio": ["level", "holdings"],
    "rules": ["level", "holdings"],
    "layout": ["level", "layout"],
    "profile": ["level", "risk", "profile"],
    "glossary": ["level"],
}


@lru_cache(maxsize=None)
def _template(name: str) -> str:
    return (PROMPT_DIR / f"{name}.md").read_text(encoding="utf-8")


def tone(context: dict) -> str:
    level = LEVEL_TONE.get(context.get("level"), LEVEL_TONE["Novice"])
    style = STYLE_TONE.get(context.get("agentStyle"), STYLE_TONE["teach me"])
    return f"{level}\n{style}"


def render(agent: str, context: dict) -> str:
    """The system prompt of one agent for one request."""
    visible = context if agent == "orchestrator" else {k: context[k] for k in CONTEXT_SLICE[agent] if k in context}
    rules = (_template("_rules").replace("{{never_words}}", ", ".join(config.NEVER_WORDS))
             .replace("{{judgement_words}}", ", ".join(checks.JUDGEMENT_WORDS)))
    return (_template(agent)
            .replace("{{rules}}", rules)
            .replace("{{tone}}", tone(context))
            .replace("{{context}}", json.dumps(visible, ensure_ascii=False, default=str)))
