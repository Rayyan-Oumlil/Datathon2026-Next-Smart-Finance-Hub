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

# The reply language, from context.locale. Every prompt carries it, in rule 7 of _rules.md.
LANGUAGE = {
    "en": "Write in English.",
    "fr": "Write in French: Canadian French as used by Québec financial institutions, plain and factual, natural "
          "rather than word for word, and always address the user as \"vous\". Use these terms: portefeuille "
          "simulé, liste de suivi intelligente, fonds négocié en bourse (FNB), titre, secteur, volatilité, "
          "capitalisation boursière, rendement, profil de risque (Faible, Moyen, Élevé), niveau (Novice, "
          "Intermédiaire, Expert), données de démonstration, simulé, échéance, the Pourquoi? panel. Write each "
          "figure with the same digits as the tool gave, in French form: decimal comma, a space before % and "
          "the $ after the amount (35,0 %, 1 500,00 $). Put a space before a colon (Source : Finnhub) and none "
          "before ? or !. Symbols (AAPL), source names and document locations stay as they are. Tool results "
          "and specialist reports may be in English: write your own text in French.",
}
# The neutral words for a trade, in rule 2 of _rules.md.
TRADE_WORDS = {
    "en": '"purchase", "sale" or "simulated trade"',
    "fr": '"acquisition simulée", "réduire la position", "ajouter au portefeuille simulé" or "opération simulée"',
}

# The slice of the context each subagent receives. Every slice holds the locale.
CONTEXT_SLICE = {
    "market_data": ["level", "locale"],
    "watchlist_explainer": ["level", "risk", "watchlist", "locale"],
    "portfolio": ["level", "holdings", "locale"],
    "rules": ["level", "holdings", "locale"],
    "layout": ["level", "layout", "locale"],
    "profile": ["level", "risk", "profile", "locale"],
    "glossary": ["level", "locale"],
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
    locale = config.locale_of(context)
    never = ", ".join(config.NEVER_WORDS)
    judgement = ", ".join(checks.JUDGEMENT_WORDS)
    if locale == "fr":
        # A French reply is checked against both lists; the French ones are named first.
        never = f"{', '.join(config.NEVER_WORDS_FR)}; in English: {never}"
        judgement = f"{', '.join(checks.JUDGEMENT_WORDS_FR)}; in English: {judgement}"
    rules = (_template("_rules").replace("{{never_words}}", never)
             .replace("{{judgement_words}}", judgement)
             .replace("{{trade_words}}", TRADE_WORDS[locale])
             .replace("{{language}}", LANGUAGE[locale]))
    return (_template(agent)
            .replace("{{rules}}", rules)
            .replace("{{tone}}", tone(context))
            .replace("{{context}}", json.dumps(visible, ensure_ascii=False, default=str)))
