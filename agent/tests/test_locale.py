"""English and French: the request locale, the French word checks, French figures, the French glossary and
the fixed texts in both languages."""
import unicodedata

import pytest

from app import checks, config, glossary, main, orchestrator, prompts, sources, trace, web_tools
from tests.test_request import PAYLOAD, conflict_then_propose, scripted

FR_PAYLOAD = {**PAYLOAD, "message": "simuler une acquisition de 500 $ de TSLA",
              "context": {**PAYLOAD["context"], "locale": "fr"}}
FR_GOOD = ("TSLA : volatilité de 58,4 % pour un plafond de 35,0 % (profil Moyen). Vous pouvez tout de même "
           "poursuivre en simulation après avoir confirmé.")
SPEC_FR_WORDS = [
    "acheter", "achetez", "achat", "vendre", "vendez", "vente", "devriez", "devrait", "devez", "il faut", "bon",
    "bonne", "sûr", "sûre", "sécuritaire", "sans risque", "va monter", "va augmenter", "vous convient",
    "recommandé", "recommandée", "recommandons", "conseillé", "conseillons",
]
SPEC_FR_JUDGEMENT = [
    "meilleur", "meilleure", "pire", "excellent", "excellente", "attrayant", "sous-évalué", "surévalué", "aubaine",
    "idéal", "prometteur", "va baisser", "va chuter", "susceptible de monter", "vaut la peine",
]


# ---- request locale

def test_locale_defaults_to_english_and_only_en_or_fr_is_accepted():
    assert main.parse_request(PAYLOAD).locale == "en"
    assert main.parse_request(FR_PAYLOAD).locale == "fr"
    with pytest.raises(ValueError):
        main.parse_request({**PAYLOAD, "context": {"locale": "pl"}})
    reply = main.invoke({**FR_PAYLOAD, "context": {"locale": "fr", "level": "Guru"}})
    assert reply["error"] == "invalid_request" and reply["text"] == checks.SAFE_REFUSALS["fr"]


def test_french_refusal_after_two_failures(monkeypatch, table, stub):
    scripted(monkeypatch, table, ["C'est un bon titre.", "Il est sûr.", "jamais"], conflict_then_propose)
    reply = main.invoke(FR_PAYLOAD)
    assert reply["refused"] is True and reply["text"] == checks.SAFE_REFUSALS["fr"]


def test_french_reply_passes_and_cites_french_labels(monkeypatch, table, stub):
    asked = scripted(monkeypatch, table, ["Vous devriez l'acheter.", FR_GOOD], conflict_then_propose)
    reply = main.invoke(FR_PAYLOAD)
    assert reply["refused"] is False and reply["text"] == FR_GOOD
    assert "Canadian French" in asked[1] and "devriez" in asked[1]
    assert reply["sources"][0]["label"] == "TSLA volatilité sur 1 an"
    built = [row for row in table.items.values() if row["step"] == "prompt_built"][0]
    assert built["dataUsed"]["locale"] == "fr"


def test_a_proposal_summary_with_a_french_never_word_is_replaced_in_french(monkeypatch, table, stub):
    def propose(current):
        orchestrator.check_profile_conflict(symbol="TSLA")
        orchestrator.record_proposal(current, "simulated_trade", "Achat de 500 $ de TSLA.",
                                     {"symbol": "TSLA", "side": "buy", "amountCad": 500})

    scripted(monkeypatch, table, [FR_GOOD], propose)
    reply = main.invoke(FR_PAYLOAD)
    assert reply["proposed"]["summary"] == "Proposition : opération simulée (simulation)."


def test_safe_refusals_pass_every_check():
    for text in checks.SAFE_REFUSALS.values():
        assert checks.own_check(text, [], [], "fr")["passed"] and checks.own_check(text, [], [])["passed"]


# ---- prompts

def test_every_prompt_names_the_reply_language():
    fr, en = FR_PAYLOAD["context"], PAYLOAD["context"]
    for name in ["orchestrator", *prompts.CONTEXT_SLICE]:
        french, english = prompts.render(name, fr), prompts.render(name, en)
        assert prompts.LANGUAGE["fr"] in french and "{{" not in french
        assert prompts.LANGUAGE["en"] in english and prompts.LANGUAGE["fr"] not in english
        assert ", ".join(config.NEVER_WORDS_FR) in french and ", ".join(checks.JUDGEMENT_WORDS_FR) in french
        assert '"locale": "fr"' in french
    assert "vous" in prompts.LANGUAGE["fr"] and "35,0 %" in prompts.LANGUAGE["fr"]
    assert "acquisition simulée" in prompts.render("orchestrator", fr)


# ---- French never-words

def test_the_french_list_holds_every_word_of_the_spec():
    assert set(SPEC_FR_WORDS) <= set(config.NEVER_WORDS_FR)
    assert config.NEVER_WORDS_FR == (config.RULES["reasons"].get("never_words_fr") or config.NEVER_WORDS_FR_DEFAULT)


@pytest.mark.parametrize("word", SPEC_FR_WORDS)
def test_every_french_never_word_is_found_in_any_case(word):
    assert checks.find_never_words(f"Alors, {word.upper()} ici.") == [word]
    assert not checks.own_check(f"Alors, {word} ici.", [], [], "fr")["passed"]


@pytest.mark.parametrize("text, found", [
    ("Achetez maintenant, puis vendez.", ["achetez", "vendez"]),
    ("Ils achètent; elle a vendu; des achats et des ventes.", ["achats", "achètent", "vendu", "ventes"]),
    ("Vous devriez attendre; il faudrait voir.", ["devriez", "il faudrait"]),
    ("Ces titres vont monter et vont augmenter.", ["vont augmenter", "vont monter"]),
    ("Des placements sûrs, sécuritaires, sans aucun risque.", ["sans aucun risque", "sécuritaires", "sûrs"]),
    ("Je vous recommande ce FNB; c'est une recommandation.", ["recommandation", "recommande"]),
    ("Ces titres vous conviennent.", ["vous conviennent"]),
    ("Un placement SÛR.", ["sûr"]),
])
def test_french_inflections_are_found(text, found):
    assert checks.find_never_words(text) == found


def test_accents_are_significant_and_any_unicode_form_matches():
    assert checks.find_never_words("Le cours est sur le graphique.") == []           # "sur", not "sûr"
    decomposed = unicodedata.normalize("NFD", "Un titre sûr.")
    assert decomposed != "Un titre sûr." and checks.find_never_words(decomposed) == ["sûr"]


@pytest.mark.parametrize("text", [
    "Le bonus, la bonification et Bonjour : seulement des parties de mots.",
    "Une obligation du gouvernement; Bombardier et Bonterra Energy sont des noms.",
    "Surtout, le rendement est sûrement affiché vendredi; la ventilation par secteur.",
    "Bien sûr, voici la volatilité.",
    "Les bons du Trésor et les bons de souscription sont des titres de créance ou des droits.",
    "Consultez un conseiller en placement pour votre situation.",
    "Une acquisition simulée, puis la réduction de la position.",
])
def test_french_false_positives_pass(text):
    assert checks.find_never_words(text) == []


# ---- French judgement words

@pytest.mark.parametrize("word", SPEC_FR_JUDGEMENT)
def test_every_french_judgement_word_is_found_and_fails_the_reply(word):
    text = f"C'est {word.upper()} ici."
    assert checks.find_judgement_words(text) == [word]
    assert not checks.own_check(text, [], [], "fr")["passed"]


@pytest.mark.parametrize("text", [
    "La volatilité de 58,4 % est plus élevée que le plafond de 35,0 %; le C/B est plus bas que la médiane.",
    "Le meilleur cours acheteur est 251,20 et le meilleur cours vendeur est 251,30.",
    "Une idéalisation, un empire, l'excellence : seulement des parties de mots.",
])
def test_factual_french_text_passes_the_judgement_check(text):
    assert checks.find_judgement_words(text) == []


def test_an_exact_french_glossary_quote_is_exempt(monkeypatch, tmp_path):
    (tmp_path / "fr").mkdir()
    quote = "Un ordre à cours limité s'exécute au prix fixé ou à un meilleur prix."
    (tmp_path / "fr" / "order-types.md").write_text(f"# Ordres\n\n{quote}\n", encoding="utf-8")
    monkeypatch.setenv("GLOSSARY_DIR", str(tmp_path))
    assert checks.find_judgement_words(f"Selon le glossaire : {quote}") == []
    assert checks.find_judgement_words("Ce prix est meilleur.") == ["meilleur"]


def test_glossary_files_hold_no_never_word_and_no_judgement_word():
    for path in checks.glossary_files():
        text = path.read_text(encoding="utf-8")
        assert checks.find_never_words(text) == [], path
        assert checks.find_never_words(text, checks.all_judgement_words()) == [], path


# ---- quoted data

NAMED = [{"endpoint": "x", "result": {"items": [{"symbol": "BBY", "entry": {"name": "Best Buy Co., Inc."}},
                                                 {"symbol": "BON", "entry": {"name": "Bonne Santé Inc."}}]}}]


def test_a_company_name_from_the_data_may_be_quoted_in_either_language():
    for reply, locale in [("Best Buy Co., Inc. is in Consumer Discretionary.", "en"),
                          ("Best Buy Co., Inc. et Bonne Santé Inc. figurent dans les données.", "fr")]:
        result = checks.own_check(reply, NAMED, [], locale)
        assert result["neverWords"] == [] and result["passed"], reply


def test_a_name_not_in_the_data_or_used_as_a_word_is_still_checked():
    assert checks.own_check("Best Buy Co., Inc. is listed.", [], [])["neverWords"] == ["buy"]
    assert checks.own_check("Best Buy Co., Inc. is a buy.", NAMED, [])["neverWords"] == ["buy"]
    assert checks.own_check("C'est une bonne idée.", NAMED, [], "fr")["neverWords"] == ["bonne"]


def test_only_short_names_are_exempt():
    from tests.stub_web import XYZ
    injected = XYZ["entry"]["name"]
    assert checks.own_check(injected, [{"result": XYZ}], [])["neverWords"]      # a long "name" is checked
    assert checks.quoted_names([{"name": "Safe"}, {"name": injected}]) == []      # one word, or too long


# ---- French figures

FR_DATA = [{"endpoint": "x", "result": {
    "price": {"value": 251.3, "unit": "USD", "source": "Finnhub", "fetchedAt": "2026-11-14T15:30:00.000Z"},
    "volatility1y": {"value": 0.584, "source": "derived", "fetchedAt": "2026-11-14T15:30:00.000Z"},
    "marketCapUsd": {"value": 801000000000, "source": "Finnhub", "fetchedAt": "2026-11-14T15:30:00.000Z"},
    "cashCad": 10000, "valueCad": 1500,
    "conflicts": [{"filter": "volatility", "pass": False, "detail": "volatilité 58,4 % contre un plafond de 35,0 %",
                   "value": 0.584, "limit": 0.35}]}}]


def test_french_figures_are_read_as_the_same_values():
    reply = ("TSLA se négocie à 251,30 $ US (Finnhub, 14 novembre 2026 à 15 h 30). Volatilité : 58,4 % pour un "
             "plafond de 35,0 %. Capitalisation boursière : 801 milliards $ US. Liquidités : 10 000,00 $; "
             "valeur 1 500 $, soit 1 500,00 $ CA.")
    assert checks.ungrounded_numbers(reply, FR_DATA, "fr") == []
    assert checks.unnamed_conflicts(reply, FR_DATA[0]["result"]["conflicts"], "fr") == []


def test_invented_french_figures_are_reported():
    reply = "TSLA est à 262,10 $ et sa volatilité est de 47 %. Le cours cible est de 2 300 $."
    assert checks.ungrounded_numbers(reply, FR_DATA, "fr") == ["262,10 $", "47 %", "2 300 $"]
    assert checks.unnamed_conflicts("Elle est plus volatile que votre profil.", FR_DATA[0]["result"]["conflicts"],
                                    "fr") == ["volatility"]


def test_french_figures_inside_data_strings_ground_a_reply():
    data = [{"detail": "plafond de 35,0 % et plancher de 2 000 000 $"}]
    assert checks.ungrounded_numbers("Plafond : 35,0 %; plancher : 2 000 000 $.", data, "fr") == []
    assert checks.ungrounded_numbers("Cap 35.0%, floor $2,000,000.", data) == []


def test_english_reading_is_unchanged():
    assert checks.numbers_in_text("1,500 and 1,5")[0]["value"] == 1500
    assert checks.numbers_in_text("1,500 et 1,5", "fr")[1]["value"] == 1.5


# ---- French glossary

def test_the_french_glossary_has_the_same_files_as_the_english_one():
    root = config.glossary_dir()
    assert sorted(p.name for p in (root / "fr").glob("*.md")) == sorted(p.name for p in root.glob("*.md"))


def test_the_glossary_tool_serves_the_files_of_the_request_locale(current):
    current.context = {**current.context, "locale": "fr"}
    top = web_tools.search_glossary(query="Qu'est-ce qu'un FNB?")["documents"][0]
    assert top["location"] == "agent/glossary/fr/etf.md" and top["text"].startswith("# FNB")
    assert glossary.search("volatilite", locale="fr")["documents"][0]["location"] == "agent/glossary/fr/volatility.md"
    current.context = {**current.context, "locale": "en"}
    assert web_tools.search_glossary(query="What is an ETF?")["documents"][0]["location"] == "agent/glossary/etf.md"


def test_a_french_request_reads_the_french_files_even_with_a_knowledge_base(monkeypatch):
    monkeypatch.setenv("KNOWLEDGE_BASE_ID", "kb-test")
    result = glossary.search("FNB", locale="fr")
    assert result["origin"] == "glossary files" and result["documents"][0]["location"].startswith("agent/glossary/fr/")


def test_french_glossary_sources_are_labelled_in_french():
    result = glossary.search("FNB", locale="fr")
    collected = sources.collect([{"endpoint": "glossary", "result": result}], "fr")
    kept = sources.relevant(collected, "Un FNB est un fonds... (agent/glossary/fr/etf.md)", "fr")
    assert kept == [{"label": "Glossaire : FNB (fonds négocié en bourse)", "source": "agent/glossary/fr/etf.md"}]


def test_french_figures_select_their_sources():
    collected = sources.collect([{"endpoint": "x", "result": {"symbol": "TSLA", **FR_DATA[0]["result"]}}], "fr")
    kept = sources.relevant(collected, "TSLA : volatilité de 58,4 %, cours 251,30 $ US à 15 h 30.", "fr")
    assert [k["label"] for k in kept] == ["TSLA cours", "TSLA volatilité sur 1 an"]


# ---- layout titles

def test_the_layout_tool_asks_for_titles_in_the_request_language(stub, current):
    current.context = {**current.context, "locale": "fr"}
    web_tools.get_layout()
    assert stub.requests[-1]["body"] == {"locale": "fr", "userId": "demo-user"}
    assert trace.current().tool_results[-1]["endpoint"].endswith("/layout")
