import pytest

from app import checks, config


@pytest.mark.parametrize("word", config.NEVER_WORDS)
def test_every_listed_word_is_found(word):
    assert checks.find_never_words(f"Well, {word.upper()} it.") == [word]


@pytest.mark.parametrize("text, found", [
    ("She is buying more.", ["buying"]),
    ("He sells and she bought.", ["bought", "sells"]),
    ("It was sold yesterday.", ["sold"]),
    ("We recommend this. A recommendation!", ["recommend", "recommendation"]),
    ("This is the safest and it moves safely.", ["safely", "safest"]),
    ("It will  rise soon.", ["will  rise"]),
    ("That would fit you.", ["fit you"]),
])
def test_inflections_are_found(text, found):
    assert checks.find_never_words(text) == found


@pytest.mark.parametrize("text", [
    "A simulated purchase of 2 units, then a sale.",
    "Goodwill, a buyout, an unsafe reseller deal: only parts of words.",
    "The shoulder of the chart; capital goods; safety.",
    "The price rose. It may go down as well as up.",
])
def test_whole_words_only(text):
    assert checks.find_never_words(text) == []


@pytest.mark.parametrize("word", checks.JUDGEMENT_WORDS)
def test_every_judgement_word_is_found_and_fails_the_reply(word):
    text = f"It is {word.upper()} here."
    assert checks.find_judgement_words(text) == [word]
    assert not checks.own_check(text, [], [])["passed"]


@pytest.mark.parametrize("text", [
    "Volatility 58.4% is higher than the cap of 35.0%; the P/E is lower than the sector median.",
    "The best ask is 251.30 and the best bid is 251.20.",
    "Betterment, a greatcoat, an idealist: only parts of words.",
    "Sector: Information Technology. Index: S&P/TSX Composite.",
])
def test_factual_data_text_passes_the_judgement_check(text):
    assert checks.find_judgement_words(text) == []


def test_glossary_files_and_safe_refusal_pass_the_judgement_check():
    assert checks.find_judgement_words(checks.SAFE_REFUSAL) == []
    for path in sorted(config.glossary_dir().glob("*.md")):
        assert checks.find_judgement_words(path.read_text(encoding="utf-8")) == [], path.name


def test_only_an_exact_glossary_quote_is_exempt(monkeypatch, tmp_path):
    # The shipped glossary holds no listed word; a file that did would be quotable word for word.
    quote = "A limit order is an instruction to trade only at a set price or better."
    (tmp_path / "order-types.md").write_text(f"# Orders\n\n{quote}\n", encoding="utf-8")
    monkeypatch.setenv("GLOSSARY_DIR", str(tmp_path))
    assert checks.find_judgement_words(f"From the glossary: {quote} (agent/glossary/order-types.md)") == []
    assert checks.find_judgement_words("This price is better.") == ["better"]


def test_corrective_instruction_names_the_judgement_words():
    own = checks.own_check("TSLA is a great bargain.", [], [])
    assert own["judgementWords"] == ["bargain", "great"]
    assert "bargain" in checks.corrective_instruction(own, {})


def test_safe_refusal_passes_the_check():
    assert checks.find_never_words(checks.SAFE_REFUSAL) == []
    assert checks.own_check(checks.SAFE_REFUSAL, [], [])["passed"]


DATA = [{"endpoint": "x", "result": {
    "price": {"value": 251.3, "unit": "USD", "source": "Finnhub", "fetchedAt": "2026-11-14T15:30:00.000Z"},
    "volatility1y": {"value": 0.584, "source": "derived", "fetchedAt": "2026-11-14T15:30:00.000Z"},
    "marketCapUsd": {"value": 801000000000, "source": "Finnhub", "fetchedAt": "2026-11-14T15:30:00.000Z"},
    "conflicts": [{"filter": "volatility", "pass": False, "detail": "volatility 58.4% vs cap 35.0% (Medium)",
                   "value": 0.584, "limit": 0.35}]}}]


def test_numbers_from_tool_results_are_grounded():
    reply = ("TSLA is at $251.30 (Finnhub, 2026-11-14 15:30 UTC). Volatility 58.4% against a cap of 35.0%. "
             "Market cap 801 billion USD, or 801,000,000,000.")
    assert checks.ungrounded_numbers(reply, DATA) == []


def test_invented_numbers_are_reported():
    reply = "TSLA is at $262.10 and its volatility is 47%. Analysts see 300."
    assert checks.ungrounded_numbers(reply, DATA) == ["$262.10", "47%", "300"]


def test_small_counts_pass_but_small_figures_do_not():
    assert checks.ungrounded_numbers("There are 3 widgets and 2 rules over 1 year.", []) == []
    assert checks.ungrounded_numbers("It moved 3% and costs $5 or 2.5.", []) == ["3%", "$5", "2.5"]


def test_numbers_from_the_message_and_context_count():
    data = [[], {"holdings": [{"symbol": "AAPL", "quantity": 30}]}, "simulate 500 dollars of TSLA"]
    assert checks.ungrounded_numbers("A purchase of 500 CAD; you hold 30 AAPL.", data) == []


def test_conflict_values_must_be_in_the_reply():
    conflicts = DATA[0]["result"]["conflicts"]
    assert checks.unnamed_conflicts("Volatility is 58.4% against a cap of 35.0%.", conflicts) == []
    assert checks.unnamed_conflicts("It is more volatile than your profile allows.", conflicts) == ["volatility"]
    assert checks.own_check("It is above your cap of 35%.", DATA, conflicts)["conflictsNotNamed"] == ["volatility"]


def test_own_check_fails_on_an_empty_reply():
    assert not checks.own_check("  ", [], [])["passed"]


def test_corrective_instruction_names_the_problems_without_being_refused_itself():
    own = checks.own_check("You should get it at $9,999.", DATA, [])
    text = checks.corrective_instruction(own, {"blocked": ["topic:InvestmentAdvice"]})
    assert "should" in text and "$9,999" in text and "topic:InvestmentAdvice" in text


class FakeGuardrailClient:
    def __init__(self, response):
        self.response, self.request = response, None

    def apply_guardrail(self, **kwargs):
        self.request = kwargs
        return self.response


def run_bedrock_check(monkeypatch, response, report_only=""):
    client = FakeGuardrailClient(response)
    monkeypatch.setenv("GUARDRAIL_ID", "gr-test")
    monkeypatch.setenv("GUARDRAIL_VERSION", "1")
    monkeypatch.setenv("GUARDRAIL_REPORT_ONLY", report_only)
    monkeypatch.setattr(checks.bedrock, "runtime_client", lambda: client)
    return checks.bedrock_check("the reply", "the tool results", "the question"), client.request


def test_guardrail_request_uses_output_source_and_the_three_qualifiers(monkeypatch):
    result, request = run_bedrock_check(monkeypatch, {"action": "NONE", "assessments": [],
                                                      "ResponseMetadata": {"RequestId": "req-1"}})
    assert result["passed"] and result["awsRequestId"] == "req-1"
    assert request["source"] == "OUTPUT" and request["guardrailIdentifier"] == "gr-test"
    assert [(c["text"]["text"], c["text"]["qualifiers"]) for c in request["content"]] == [
        ("the tool results", ["grounding_source"]), ("the question", ["query"]), ("the reply", ["guard_content"])]


BLOCKING = {"action": "GUARDRAIL_INTERVENED", "outputs": [{"text": "blocked message"}], "assessments": [{
    "topicPolicy": {"topics": [{"name": "InvestmentAdvice", "action": "BLOCKED"}]},
    "wordPolicy": {"customWords": [{"match": "buy", "action": "BLOCKED"}]},
    "contextualGroundingPolicy": {"filters": [
        {"type": "GROUNDING", "score": 0.4, "threshold": 0.7, "action": "BLOCKED"},
        {"type": "RELEVANCE", "score": 0.9, "threshold": 0.5, "action": "NONE"}]}}]}


def test_guardrail_blocks_are_reported(monkeypatch):
    result, _ = run_bedrock_check(monkeypatch, BLOCKING)
    assert not result["passed"]
    assert result["blocked"] == ["topic:InvestmentAdvice", "word:buy", "grounding:0.4"]
    assert result["scores"]["relevance"] == {"score": 0.9, "threshold": 0.5}
    assert "maskedText" not in result


def test_report_only_policies_are_logged_but_do_not_fail(monkeypatch):
    result, _ = run_bedrock_check(monkeypatch, BLOCKING, report_only="topic")
    assert result["blocked"] == ["word:buy", "grounding:0.4"] and result["reportedOnly"] == ["topic:InvestmentAdvice"]


def test_masked_personal_data_replaces_the_text(monkeypatch):
    response = {"action": "GUARDRAIL_INTERVENED", "outputs": [{"text": "write to {EMAIL}"}], "assessments": [{
        "sensitiveInformationPolicy": {"piiEntities": [{"type": "EMAIL", "match": "a@b.c", "action": "ANONYMIZED"}]}}]}
    result, _ = run_bedrock_check(monkeypatch, response)
    assert result["passed"] and result["maskedText"] == "write to {EMAIL}"


def test_guardrail_is_skipped_when_not_configured(monkeypatch):
    monkeypatch.setenv("GUARDRAIL_ID", "")
    assert checks.bedrock_check("a", "b", "c") == {"passed": True, "skipped": "GUARDRAIL_ID not set"}


def test_figures_with_a_unit_letter_are_checked():
    data = [{"marketCapUsd": {"value": 801_000_000_000}}, {"marketCapUsd": {"value": 3_450_000_000_000}}]
    assert checks.ungrounded_numbers("Market cap $801B; the other is $3.45T (3.45 trillion).", data) == []
    assert checks.ungrounded_numbers("Market cap $950B, P/E 68x.", data) == ["$950", "68"]


def test_contracted_form_is_found_and_a_long_reply_fails():
    assert checks.find_never_words("You shouldn't do that.") == ["shouldn't"]
    assert checks.own_check("word " * 1200, [], [])["tooLong"] is True
    assert checks.own_check("Short reply.", [], [])["passed"] is True


# ---- replies about a settings change (layout, rule, strategy, profile)

def test_a_settings_reply_is_checked_for_wording_only():
    # A short confirmation with a figure from nowhere: no market figure is stated, so it is not a grounding failure
    own = checks.own_check("I set the cap at 20% for 3 holdings.", [[], {}, None], [], "en", setting=True)
    assert own["passed"] and own["ungroundedNumbers"] == []
    # The wording still counts
    assert not checks.own_check("Now you should buy more.", [[], {}, None], [], "en", setting=True)["passed"]
    # Without the flag the same figures must be grounded
    assert checks.own_check("I set the cap at 20% for 3 holdings.", [[], {}, None], [], "en")["ungroundedNumbers"] == ["20%"]


def test_widget_titles_and_quoted_user_text_are_not_judged():
    layout = [{"endpoint": "/api/internal/tools/layout", "result": {"library": [{"id": "x", "title": "Best and worst movers"}]}}]
    assert checks.own_check("Best and worst movers is now hidden.", [layout, {}, None], [], "en", setting=True)["passed"]
    quoted = checks.quoted_user_text("Your strategy « Bon départ » is ready.", ["Crée la stratégie Bon départ"])
    assert quoted == ["Bon départ"]
    assert checks.own_check("Your strategy « Bon départ » is ready.", [[], {}, None], [], "fr", setting=True,
                            exempt=quoted)["passed"]
    # A quote the user never wrote, or a long one, is still checked
    assert checks.quoted_user_text("« you should buy » it", ["hello"]) == []
    assert checks.quoted_user_text('"buy it now and then keep buying every single day"', ["buy it now and then keep buying every single day"]) == []


def test_a_settings_reply_skips_the_contextual_grounding_check(monkeypatch):
    client = FakeGuardrailClient(BLOCKING)
    monkeypatch.setenv("GUARDRAIL_ID", "gr-test")
    monkeypatch.setenv("GUARDRAIL_REPORT_ONLY", "")
    monkeypatch.setattr(checks.bedrock, "runtime_client", lambda: client)
    result = checks.bedrock_check("the reply", "facts", "question", check_grounding=False, words_checked=True)
    assert [c["text"]["qualifiers"] for c in client.request["content"]] == [["guard_content"]]
    # The advice topic still blocks; grounding and the word filter (already checked by our own lists) are reported only
    assert result["blocked"] == ["topic:InvestmentAdvice"]
    assert result["reportedOnly"] == ["word:buy", "grounding:0.4"]
