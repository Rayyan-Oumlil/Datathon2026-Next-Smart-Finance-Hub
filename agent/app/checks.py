"""The checks run in plain code on every reply, after the model answers.

1. Never-words: the words of rules/v1.json (reasons.never_words, and reasons.never_words_fr for French) and
   their simple inflections. Judgement words: the JUDGEMENT_WORDS and JUDGEMENT_WORDS_FR below (judgement and
   prediction wording). Both languages are checked on every reply, whatever its language: whole words, any
   letter case, accents significant ("sur" is not "sûr"), text compared in Unicode NFC form.
   Quoted data is exempt, and only this:
   - a company or asset name found under a "name" key in this request's tool results or in the context the web
     app built, of 2 to 6 words and at most 60 characters (so "Best Buy Co., Inc." can be named, while a long
     "name" carrying an instruction is still checked word by word); the user's message and history never count;
   - for the judgement words only, an exact sentence of the vetted glossary (English or French files);
   - fixed phrases that hold a listed word without judging anything (NEVER_EXEMPT_PHRASES,
     JUDGEMENT_EXEMPT_PHRASES), such as "best bid" or "bien sûr".
2. Grounded numbers: every figure in the reply must appear in a tool result of this request
   or in the context the web app built. Client-supplied history and the message do not count.
   French replies write figures the French way ("35,0 %", "1 500,00 $"); they are read as the same values.
3. Conflicts named: when the profile-conflict check found conflicts, their values must be in the reply.
4. Bedrock ApplyGuardrail on the reply (word filter, denied topic, personal data, grounding).
"""
import json
import re
import unicodedata

from . import bedrock, config

SAFE_REFUSAL = (
    "I can't answer that here. I can explain a term from the glossary, show data with its source, "
    "or explain why an asset is on your list. This app is a simulation and does not give investment advice."
)
SAFE_REFUSALS = {
    "en": SAFE_REFUSAL,
    "fr": "Je ne peux pas répondre à cette demande ici. Je peux expliquer un terme du glossaire, présenter des "
          "données avec leur source ou expliquer pourquoi un titre figure sur votre liste. Cette application est "
          "une simulation et ne donne aucun conseil en placement.",
}


def safe_refusal(locale: str) -> str:
    return SAFE_REFUSALS.get(locale, SAFE_REFUSAL)


# Inflections checked on top of the listed word itself. Keyed by the word as written in rules/v1.json, or in
# the judgement lists below.
INFLECTIONS = {
    "buy": ["buys", "buying", "bought", "buyer", "buyers"],
    "sell": ["sells", "selling", "sold", "seller", "sellers"],
    "safe": ["safer", "safest", "safely"],
    "will rise": ["will go up"],
    "fits you": ["fit you"],
    "recommended": ["recommend", "recommends", "recommending", "recommendation", "recommendations"],
    "should": ["shouldn't", "shouldn’t", "shouldnt"],
    # French never-words
    "acheter": ["achète", "achètes", "achètent", "achetons", "acheté", "achetée", "achetés", "achetées",
                "achèterait", "achèteriez", "achetant", "achete", "achetent"],
    "achat": ["achats"],
    "vendre": ["vends", "vend", "vendent", "vendons", "vendu", "vendue", "vendus", "vendues", "vendrait",
               "vendriez", "vendant"],
    "vente": ["ventes"],
    "devriez": ["devrais", "devrions"],
    "devrait": ["devraient"],
    "il faut": ["il faudrait", "il faudra"],
    "bon": ["bons"],
    "bonne": ["bonnes"],
    "sûr": ["sûrs"],
    "sûre": ["sûres"],
    "sécuritaire": ["sécuritaires", "securitaire", "securitaires"],
    "sans risque": ["sans risques", "sans aucun risque"],
    "va monter": ["vont monter", "va remonter", "vont remonter"],
    "va augmenter": ["vont augmenter"],
    "vous convient": ["vous conviennent", "vous conviendrait", "vous conviendraient"],
    "recommandé": ["recommandés", "recommande", "recommandes", "recommandez", "recommandent", "recommander",
                   "recommandation", "recommandations"],
    "recommandée": ["recommandées"],
    "conseillé": ["conseillés", "conseille", "conseilles", "conseillez", "conseillent"],
    "conseillée": ["conseillées"],
    # French judgement and prediction words
    "meilleur": ["meilleure", "meilleurs", "meilleures"],
    "pire": ["pires"],
    "excellent": ["excellente", "excellents", "excellentes"],
    "attrayant": ["attrayante", "attrayants", "attrayantes"],
    "sous-évalué": ["sous-évaluée", "sous-évalués", "sous-évaluées"],
    "surévalué": ["surévaluée", "surévalués", "surévaluées"],
    "aubaine": ["aubaines"],
    "idéal": ["idéale", "idéaux", "idéales"],
    "prometteur": ["prometteuse", "prometteurs", "prometteuses"],
    "va baisser": ["vont baisser"],
    "va chuter": ["vont chuter"],
    "susceptible de monter": ["susceptibles de monter"],
    "vaut la peine": ["valent la peine"],
}

# Fixed phrases that hold a never-word without being advice: "of course", treasury bills, warrants.
NEVER_EXEMPT_PHRASES = ["bien sûr", "bon du Trésor", "bons du Trésor", "bon de souscription",
                        "bons de souscription"]


def nfc(text: str) -> str:
    return unicodedata.normalize("NFC", text)


def _phrase(form: str) -> str:
    """A listed form as a pattern body: spaces match any run of spaces, a hyphen also matches a space."""
    parts = [re.escape(part).replace(r"\-", "[-‑ ]?") for part in nfc(form).split()]
    return r"\s+".join(parts)


def _whole(form: str) -> re.Pattern:
    # \w is Unicode-aware here, so "sûrement" does not hold "sûr" and "bonus" does not hold "bon".
    return re.compile(rf"(?<!\w){_phrase(form)}(?!\w)", re.IGNORECASE)


def _remove(text: str, phrases) -> str:
    for phrase in phrases:
        text = _whole(phrase).sub(" ", text)
    return text


def all_never_words() -> list[str]:
    return [*config.NEVER_WORDS, *config.NEVER_WORDS_FR]


def never_word_patterns(words: list[str] | None = None) -> list[tuple[str, re.Pattern]]:
    patterns = []
    for word in words if words is not None else all_never_words():
        for form in [word, *INFLECTIONS.get(word, [])]:
            patterns.append((word, _whole(form)))
    return patterns


def find_never_words(text: str, words: list[str] | None = None) -> list[str]:
    """The forms found in the text, whole words only, any letter case."""
    text = _remove(nfc(text), NEVER_EXEMPT_PHRASES)
    found = []
    for _, pattern in never_word_patterns(words):
        for match in pattern.finditer(text):
            found.append(match.group(0).lower())
    return sorted(set(found))


# Judgement and prediction wording. The Bedrock Guardrail's advice topic only detects, so these lists and the
# never-words are what fail a draft. The only lists of these words; agent/app/prompts/_rules.md names them too.
# "higher" and "lower" are not on it: "higher than the cap" is a comparison of two figures, not a judgement.
JUDGEMENT_WORDS = [
    "better", "best", "worse", "worst", "excellent", "great", "attractive", "undervalued", "overvalued", "cheap",
    "expensive", "ideal", "suits", "suitable", "strong pick", "top pick", "promising", "bargain", "outperform",
    "underperform", "will go up", "will go down", "will fall", "will drop", "likely to rise", "likely to fall",
    "worth owning",
]
# The same for French. "plus élevé" and "plus bas" are not on it, for the same reason.
JUDGEMENT_WORDS_FR = [
    "meilleur", "pire", "excellent", "attrayant", "sous-évalué", "surévalué", "aubaine", "idéal", "prometteur",
    "va baisser", "va chuter", "susceptible de monter", "vaut la peine",
]
# Fixed phrases of market data that hold a listed word without judging anything.
JUDGEMENT_EXEMPT_PHRASES = ["best ask", "best bid", "meilleur cours acheteur", "meilleur cours vendeur"]


def all_judgement_words() -> list[str]:
    return [*JUDGEMENT_WORDS, *[word for word in JUDGEMENT_WORDS_FR if word not in JUDGEMENT_WORDS]]


def _sentences(text: str) -> list[str]:
    return [part.strip() for part in re.split(r"(?<=[.!?])\s+|\n+", nfc(text)) if part.strip()]


def glossary_files() -> list:
    """The vetted glossary in both languages: the English files and the French ones under fr/."""
    root = config.glossary_dir()
    return [*sorted(root.glob("*.md")), *sorted((root / "fr").glob("*.md"))]


def _glossary_sentences() -> list[str]:
    """Glossary sentences that hold a listed word: an exact quote of the vetted glossary is allowed."""
    found = []
    for path in glossary_files():
        for sentence in _sentences(path.read_text(encoding="utf-8")):
            if find_never_words(sentence, all_judgement_words()):
                found.append(sentence)
    return found


def find_judgement_words(text: str) -> list[str]:
    """The judgement words found in the text, whole words, any letter case. Exact glossary quotes and the
    fixed market-data phrases are left out first."""
    text = nfc(text)
    for sentence in _glossary_sentences():
        text = text.replace(sentence, " ")
    text = _remove(text, JUDGEMENT_EXEMPT_PHRASES)
    return find_never_words(text, all_judgement_words())


# ---------------------------------------------------------------- quoted data

MAX_NAME_CHARS = 60
MAX_NAME_WORDS = 6


# Keys whose short string values are names the reply may quote as they are: company and asset names ("name"),
# and the app's own widget titles as the layout tool gives them ("title").
NAME_KEYS = ("name", "title")


def quoted_names(data) -> list[str]:
    """Company and asset names held under a "name" key, and widget titles under a "title" key, in the data: these
    may be quoted as they are."""
    found = set()

    def walk(node):
        if isinstance(node, dict):
            for key, value in node.items():
                if key in NAME_KEYS and isinstance(value, str):
                    name = " ".join(nfc(value).split())
                    if 2 <= len(name.split()) <= MAX_NAME_WORDS and len(name) <= MAX_NAME_CHARS:
                        found.add(name)
                else:
                    walk(value)
        elif isinstance(node, (list, tuple)):
            for value in node:
                walk(value)

    walk(data)
    return sorted(found, key=len, reverse=True)


def without_quoted_names(text: str, data, extra: list[str] | tuple = ()) -> str:
    """The text with each exact name from the data (and each extra text) taken out, so a listed word inside a name
    is not counted."""
    text = nfc(text)
    names = sorted({*quoted_names(data), *(nfc(item) for item in extra if item)}, key=len, reverse=True)
    for name in names:
        text = re.sub(rf"(?<!\w){re.escape(name)}(?!\w)", " ", text, flags=re.IGNORECASE)
    return text


# Text between quotation marks in a reply: «…», “…”, "…", ‘…’ and '…'.
_QUOTED = re.compile(r"«\s*([^«»]{1,80}?)\s*»|“([^“”]{1,80}?)”|\"([^\"]{1,80}?)\"|‘([^‘’]{1,80}?)’|(?<!\w)'([^']{1,80}?)'(?!\w)")


def quoted_user_text(reply: str, sources: list[str]) -> list[str]:
    """Quoted parts of the reply that repeat, word for word, a short piece of the user's own text or of a name the
    user gave (a strategy name, a rule's wording). A configuration reply may echo them: "Your strategy « Bon départ »".
    Only short quotes count (MAX_NAME_WORDS words, MAX_NAME_CHARS characters), so a long instruction is still checked."""
    haystack = [" ".join(nfc(source).split()).casefold() for source in sources if isinstance(source, str) and source]
    found = []
    for match in _QUOTED.finditer(nfc(reply)):
        quote = " ".join(next(group for group in match.groups() if group).split())
        if not quote or len(quote) > MAX_NAME_CHARS or len(quote.split()) > MAX_NAME_WORDS:
            continue
        if any(quote.casefold() in source for source in haystack):
            found.append(quote)
    return found


# ---------------------------------------------------------------- numbers

# English: "1,500.25", "$251.30", "35.0%".
_NUMBER_EN = re.compile(r"(?<![A-Za-z_\d.,])(\$?)(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(\s?%)?(?![_\d])")
# French: "1 500,25 $", "35,0 %" (regular, no-break or narrow no-break space); a decimal point is read too.
_GROUP_SPACE = "[   ]"
_NUMBER_FR = re.compile(rf"(?<![\w.,])(\$\s?)?(\d{{1,3}}(?:{_GROUP_SPACE}\d{{3}})+(?!\d)|\d+)([.,]\d+)?"
                        r"(\s?%|\s?\$)?(?![_\d])")
# as is; fraction shown as a percent; thousands, millions, billions, trillions
_SCALES = (1, 100, 1e-3, 1e-6, 1e-9, 1e-12)
MAX_REPLY_CHARS = 5000                 # ApplyGuardrail checks at most this much guarded text
_SMALL = 12                            # bare whole numbers up to this are counts or list numbers, not figures


def numbers_in_text(text: str, locale: str = "en") -> list[dict]:
    """Figures written in a text: value, decimals, and whether it carries a $ or % sign."""
    found = []
    for match in (_NUMBER_FR if locale == "fr" else _NUMBER_EN).finditer(text):
        before, whole, fraction, after = match.groups()
        whole = re.sub(r"[^\d]", "", whole)
        fraction = fraction.replace(",", ".") if fraction else None
        found.append({
            "text": match.group(0).strip(),
            "value": float(whole + (fraction or "")),
            "decimals": len(fraction) - 1 if fraction else 0,
            "marked": bool(before or after or fraction),
        })
    return found


# Numbers written inside the data's strings, in either language's way.
_DATA_EN = re.compile(r"\d+(?:,\d{3})*(?:\.\d+)?")
_DATA_FR = re.compile(rf"\d{{1,3}}(?:{_GROUP_SPACE}\d{{3}})+(?:,\d+)?|\d+,\d+")


def numbers_in_data(data) -> list[float]:
    """Every number held in a JSON value, including the ones written inside its strings."""
    found = []

    def walk(node):
        if isinstance(node, bool) or node is None:
            return
        if isinstance(node, (int, float)):
            found.append(abs(float(node)))
        elif isinstance(node, str):
            found.extend(float(m.replace(",", "")) for m in _DATA_EN.findall(node))
            found.extend(float(re.sub(_GROUP_SPACE, "", m).replace(",", ".")) for m in _DATA_FR.findall(node))
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


def ungrounded_numbers(reply: str, data, locale: str = "en") -> list[str]:
    known = numbers_in_data(data)
    missing = []
    for number in numbers_in_text(reply, locale):
        if not number["marked"] and number["value"] <= _SMALL:
            continue
        if not matches(number["value"], number["decimals"], known):
            missing.append(number["text"])
    return missing


def unnamed_conflicts(reply: str, conflicts: list[dict], locale: str = "en") -> list[str]:
    """Conflicts whose actual value or limit is not stated in the reply."""
    written = numbers_in_text(reply, locale)
    missing = []
    for check in conflicts:
        figures = [check.get(key) for key in ("value", "limit") if isinstance(check.get(key), (int, float))]
        if any(not any(matches(w["value"], w["decimals"], [abs(f)]) for w in written) for f in figures):
            missing.append(check.get("filter", "?"))
    return missing


def own_check(reply: str, data, conflicts: list[dict], locale: str = "en", *, setting: bool = False,
              exempt: list[str] | tuple = ()) -> dict:
    """setting: the reply goes with a proposed settings change (layout, rule, strategy, profile). It states no market
    figure, so only the wording is checked: the grounded-numbers and conflicts-named checks are skipped.
    exempt: extra texts the wording check leaves out (quoted user text, names the user gave)."""
    words_text = without_quoted_names(reply, data, exempt)
    result = {
        "neverWords": find_never_words(words_text),
        "judgementWords": find_judgement_words(words_text),
        "ungroundedNumbers": [] if setting else ungrounded_numbers(reply, data, locale),
        "conflictsNotNamed": [] if setting else unnamed_conflicts(reply, conflicts, locale),
        "empty": not reply.strip(),
        # A longer reply would leave its tail unchecked by the Bedrock Guardrail.
        "tooLong": len(reply) > MAX_REPLY_CHARS,
    }
    result["passed"] = not any(result.values())
    return result


# ---------------------------------------------------------------- Bedrock Guardrail

# Contextual grounding policies: they score a reply against the facts it should restate.
GROUNDING_POLICIES = ("grounding", "relevance")


def bedrock_check(reply: str, grounding_source: str, query: str, *, check_grounding: bool = True,
                  words_checked: bool = False) -> dict:
    """ApplyGuardrail on the reply (source OUTPUT). Returns what was blocked and the masked text, if any.

    check_grounding=False (a short sentence about a settings change, or a question back about one): no grounding source
    or query is sent, so the contextual grounding check does not run, and a grounding or relevance block is only
    reported. words_checked=True: our own wording check already passed this reply with its quoted names and user
    text left out, so a word-filter block (which cannot tell a quoted name from advice) is only reported."""
    guardrail_id = config.env("GUARDRAIL_ID")
    if not guardrail_id:
        return {"passed": True, "skipped": "GUARDRAIL_ID not set"}
    content = [{"text": {"text": reply[:MAX_REPLY_CHARS], "qualifiers": ["guard_content"]}}]
    if check_grounding:
        content = [
            {"text": {"text": grounding_source[:95000], "qualifiers": ["grounding_source"]}},
            {"text": {"text": query[:1000], "qualifiers": ["query"]}},
            *content,
        ]
    response = bedrock.runtime_client().apply_guardrail(
        guardrailIdentifier=guardrail_id,
        guardrailVersion=config.env("GUARDRAIL_VERSION", "DRAFT"),
        source="OUTPUT",
        outputScope="FULL",
        content=content,
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
    if not check_grounding:
        report_only |= set(GROUNDING_POLICIES)
    if words_checked:
        report_only.add("word")
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


def corrective_instruction(own: dict, guardrail: dict, locale: str = "en") -> str:
    problems = []
    if own.get("empty"):
        problems.append("the reply was empty")
    if own.get("tooLong"):
        problems.append(f"it was longer than {MAX_REPLY_CHARS} characters; make it much shorter")
    if own.get("neverWords"):
        problems.append("it used words that are not allowed: " + ", ".join(own["neverWords"]))
    if own.get("judgementWords"):
        problems.append("it used judgement or prediction wording that is not allowed: "
                        + ", ".join(own["judgementWords"]))
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
            "judgement, and avoid the words that are not allowed. Do not propose the action again."
            + (" " + LANGUAGE_REMINDER[locale] if locale in LANGUAGE_REMINDER else ""))


# Repeated in the corrective instruction, so a rewrite stays in the request's language.
LANGUAGE_REMINDER = {
    "fr": "Write the reply in Canadian French (vouvoiement), with French number formatting such as 35,0 %.",
}


def grounding_text(tool_results: list, context: dict, proposed_params: dict | None = None) -> str:
    facts = ("This app is a simulation and gives no investment advice. The assistant can only propose an action; "
             "the app shows a preview and applies it only after the user confirms. "
             "A simulated trade may go ahead after the user confirms, including when it conflicts with the profile.")
    return facts + "\n\nTool results:\n" + json.dumps(tool_results, default=str) + \
        "\n\nContext:\n" + json.dumps(context, default=str) + \
        ("\n\nProposed action params:\n" + json.dumps(proposed_params, default=str) if proposed_params else "")
