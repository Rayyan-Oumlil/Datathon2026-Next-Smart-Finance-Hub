"""The checks run in plain code on every reply, after the model answers.

1. Never-words: the words of rules/v1.json (reasons.never_words) and their simple inflections.
2. Grounded numbers: every figure in the reply must appear in a tool result of this request,
   in the context or in the user's own messages.
3. Conflicts named: when the profile-conflict check found conflicts, their values must be in the reply.
4. Bedrock ApplyGuardrail on the reply (word filter, denied topic, personal data, grounding).
"""
import json
import re

from . import bedrock, config

SAFE_REFUSAL = (
    "I can't answer that here. I can explain a term from the glossary, show data with its source, "
    "or explain why an asset is on your list. This app is a simulation and does not give investment advice."
)

# Inflections checked on top of the listed word itself. Keyed by the word as written in rules/v1.json.
INFLECTIONS = {
    "buy": ["buys", "buying", "bought", "buyer", "buyers"],
    "sell": ["sells", "selling", "sold", "seller", "sellers"],
    "safe": ["safer", "safest", "safely"],
    "will rise": ["will go up"],
    "fits you": ["fit you"],
    "recommended": ["recommend", "recommends", "recommending", "recommendation", "recommendations"],
    "should": ["shouldn't", "shouldn’t", "shouldnt"],
}


def never_word_patterns(words: list[str] | None = None) -> list[tuple[str, re.Pattern]]:
    patterns = []
    for word in words if words is not None else config.NEVER_WORDS:
        for form in [word, *INFLECTIONS.get(word, [])]:
            body = r"\s+".join(re.escape(part) for part in form.split())
            patterns.append((word, re.compile(rf"(?<![\w]){body}(?![\w])", re.IGNORECASE)))
    return patterns


def find_never_words(text: str, words: list[str] | None = None) -> list[str]:
    """The forms found in the text, whole words only, any letter case."""
    found = []
    for _, pattern in never_word_patterns(words):
        for match in pattern.finditer(text):
            found.append(match.group(0).lower())
    return sorted(set(found))


# ---------------------------------------------------------------- numbers

_NUMBER = re.compile(r"(?<![A-Za-z_\d.,])(\$?)(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(\s?%)?(?![_\d])")
# as is; fraction shown as a percent; thousands, millions, billions, trillions
_SCALES = (1, 100, 1e-3, 1e-6, 1e-9, 1e-12)
MAX_REPLY_CHARS = 5000                 # ApplyGuardrail checks at most this much guarded text
_SMALL = 12                            # bare whole numbers up to this are counts or list numbers, not figures


def numbers_in_text(text: str) -> list[dict]:
    """Figures written in a text: value, decimals, and whether it carries a $ or % sign."""
    found = []
    for match in _NUMBER.finditer(text):
        dollar, whole, fraction, percent = match.groups()
        found.append({
            "text": match.group(0).strip(),
            "value": float(whole.replace(",", "") + (fraction or "")),
            "decimals": len(fraction) - 1 if fraction else 0,
            "marked": bool(dollar or percent or fraction),
        })
    return found


def numbers_in_data(data) -> list[float]:
    """Every number held in a JSON value, including the ones written inside its strings."""
    found = []

    def walk(node):
        if isinstance(node, bool) or node is None:
            return
        if isinstance(node, (int, float)):
            found.append(abs(float(node)))
        elif isinstance(node, str):
            found.extend(float(m.replace(",", "")) for m in re.findall(r"\d+(?:,\d{3})*(?:\.\d+)?", node))
        elif isinstance(node, dict):
            for value in node.values():
                walk(value)
        elif isinstance(node, (list, tuple)):
            for value in node:
                walk(value)

    walk(data)
    return found


def matches(value: float, decimals: int, known: list[float]) -> bool:
    """True when a known number equals the value at the precision it was written with, at one of the scales."""
    tolerance = 0.5 * 10 ** -decimals + 1e-9
    return any(abs(number * scale - value) <= tolerance for number in known for scale in _SCALES)


def ungrounded_numbers(reply: str, data) -> list[str]:
    known = numbers_in_data(data)
    missing = []
    for number in numbers_in_text(reply):
        if not number["marked"] and number["value"] <= _SMALL:
            continue
        if not matches(number["value"], number["decimals"], known):
            missing.append(number["text"])
    return missing


def unnamed_conflicts(reply: str, conflicts: list[dict]) -> list[str]:
    """Conflicts whose actual value or limit is not stated in the reply."""
    written = numbers_in_text(reply)
    missing = []
    for check in conflicts:
        figures = [check.get(key) for key in ("value", "limit") if isinstance(check.get(key), (int, float))]
        if any(not any(matches(w["value"], w["decimals"], [abs(f)]) for w in written) for f in figures):
            missing.append(check.get("filter", "?"))
    return missing


def own_check(reply: str, data, conflicts: list[dict]) -> dict:
    result = {
        "neverWords": find_never_words(reply),
        "ungroundedNumbers": ungrounded_numbers(reply, data),
        "conflictsNotNamed": unnamed_conflicts(reply, conflicts),
        "empty": not reply.strip(),
        # A longer reply would leave its tail unchecked by the Bedrock Guardrail.
        "tooLong": len(reply) > MAX_REPLY_CHARS,
    }
    result["passed"] = not any(result.values())
    return result


# ---------------------------------------------------------------- Bedrock Guardrail

def bedrock_check(reply: str, grounding_source: str, query: str) -> dict:
    """ApplyGuardrail on the reply (source OUTPUT). Returns what was blocked and the masked text, if any."""
    guardrail_id = config.env("GUARDRAIL_ID")
    if not guardrail_id:
        return {"passed": True, "skipped": "GUARDRAIL_ID not set"}
    response = bedrock.runtime_client().apply_guardrail(
        guardrailIdentifier=guardrail_id,
        guardrailVersion=config.env("GUARDRAIL_VERSION", "DRAFT"),
        source="OUTPUT",
        outputScope="FULL",
        content=[
            {"text": {"text": grounding_source[:95000], "qualifiers": ["grounding_source"]}},
            {"text": {"text": query[:1000], "qualifiers": ["query"]}},
            {"text": {"text": reply[:MAX_REPLY_CHARS], "qualifiers": ["guard_content"]}},
        ],
    )
    blocked, scores, masked = [], {}, False
    for assessment in response.get("assessments", []):
        for topic in assessment.get("topicPolicy", {}).get("topics", []):
            if topic.get("action") == "BLOCKED":
                blocked.append(f"topic:{topic.get('name')}")
        words = assessment.get("wordPolicy", {})
        for word in words.get("customWords", []) + words.get("managedWordLists", []):
            if word.get("action") == "BLOCKED":
                blocked.append(f"word:{word.get('match')}")
        pii = assessment.get("sensitiveInformationPolicy", {})
        for entity in pii.get("piiEntities", []) + pii.get("regexes", []):
            if entity.get("action") == "BLOCKED":
                blocked.append(f"pii:{entity.get('type') or entity.get('name')}")
            masked = masked or entity.get("action") == "ANONYMIZED"
        for item in assessment.get("contentPolicy", {}).get("filters", []):
            if item.get("action") == "BLOCKED":
                blocked.append(f"content:{item.get('type')}")
        for item in assessment.get("contextualGroundingPolicy", {}).get("filters", []):
            scores[item.get("type", "?").lower()] = {"score": item.get("score"), "threshold": item.get("threshold")}
            if item.get("action") == "BLOCKED":
                blocked.append(f"{item.get('type', '').lower()}:{item.get('score')}")
    # GUARDRAIL_REPORT_ONLY (empty by default) names policies whose blocks are logged but do not fail the reply.
    report_only = {name.strip().lower() for name in config.env("GUARDRAIL_REPORT_ONLY").split(",") if name.strip()}
    reported = [item for item in blocked if item.split(":")[0] in report_only]
    blocked = [item for item in blocked if item not in reported]
    result = {
        "passed": not blocked,
        "action": response.get("action"),
        "blocked": blocked,
        "reportedOnly": reported,
        "scores": scores,
        "awsRequestId": response.get("ResponseMetadata", {}).get("RequestId"),
    }
    # Personal data masked and nothing blocked: the masked text replaces the reply.
    if masked and not blocked and not reported and response.get("outputs"):
        result["maskedText"] = response["outputs"][0].get("text")
    return result


def corrective_instruction(own: dict, guardrail: dict) -> str:
    problems = []
    if own.get("empty"):
        problems.append("the reply was empty")
    if own.get("tooLong"):
        problems.append(f"it was longer than {MAX_REPLY_CHARS} characters; make it much shorter")
    if own.get("neverWords"):
        problems.append("it used words that are not allowed: " + ", ".join(own["neverWords"]))
    if own.get("ungroundedNumbers"):
        problems.append("these figures are not in any tool result of this request: "
                        + ", ".join(own["ungroundedNumbers"]))
    if own.get("conflictsNotNamed"):
        problems.append("it did not state the actual value and limit of these profile conflicts: "
                        + ", ".join(own["conflictsNotNamed"]))
    if guardrail.get("blocked"):
        problems.append("the output guardrail blocked it (" + ", ".join(guardrail["blocked"]) + ")")
    return ("Your last reply was not accepted: " + "; ".join(problems) + ". Write the reply again. "
            "State only facts and figures found in the tool results, name their source, give no advice or "
            "judgement, and avoid the words that are not allowed. Do not propose the action again.")


def grounding_text(tool_results: list, context: dict) -> str:
    facts = ("This app is a simulation and gives no investment advice. The assistant can only propose an action; "
             "the app shows a preview and applies it only after the user confirms. "
             "A simulated trade may go ahead after the user confirms, including when it conflicts with the profile.")
    return facts + "\n\nTool results:\n" + json.dumps(tool_results, default=str) + \
        "\n\nContext:\n" + json.dumps(context, default=str)
