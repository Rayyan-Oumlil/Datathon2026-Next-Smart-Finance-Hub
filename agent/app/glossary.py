"""The vetted glossary, in the request's language.

English: Bedrock Knowledge Base when KNOWLEDGE_BASE_ID is set, else the markdown files in agent/glossary/.
French: the markdown files in agent/glossary/fr/ (same file names, same facts). The Knowledge Base holds the
English files only, so a French request always reads the French files and cites their path.
"""
import re
import unicodedata

from . import bedrock, config


def _words(text: str) -> set[str]:
    """Lower-case words with accents removed, so "volatilite" finds "volatilité"."""
    plain = unicodedata.normalize("NFKD", text.lower())
    plain = "".join(char for char in plain if not unicodedata.combining(char))
    return set(re.findall(r"[a-z0-9]+", plain))


def glossary_dir(locale: str = "en"):
    root = config.glossary_dir()
    return root / "fr" if locale == "fr" else root


def location(locale: str, file_name: str) -> str:
    return f"agent/glossary/fr/{file_name}" if locale == "fr" else f"agent/glossary/{file_name}"


def _search_files(query: str, limit: int, locale: str = "en") -> list[dict]:
    wanted = _words(query)
    found = []
    for path in sorted(glossary_dir(locale).glob("*.md")):
        text = path.read_text(encoding="utf-8").strip()
        title = text.splitlines()[0].lstrip("# ").strip()
        # A word of the query in the title or file name counts three times a word in the body.
        score = 3 * len(wanted & (_words(title) | _words(path.stem))) + len(wanted & _words(text))
        if score:
            found.append({"title": title, "text": text, "location": location(locale, path.name), "score": score})
    return sorted(found, key=lambda doc: -doc["score"])[:limit]


def _search_knowledge_base(query: str, limit: int) -> list[dict]:
    # Written from the Retrieve API reference; not run, because the account cannot create a Knowledge Base.
    response = bedrock.kb_client().retrieve(
        knowledgeBaseId=config.env("KNOWLEDGE_BASE_ID"),
        retrievalQuery={"text": query},
        retrievalConfiguration={"vectorSearchConfiguration": {"numberOfResults": limit}},
    )
    found = []
    for item in response.get("retrievalResults", []):
        text = item.get("content", {}).get("text", "")
        location = item.get("location", {}).get("s3Location", {}).get("uri", "knowledge base")
        title = text.strip().splitlines()[0].lstrip("# ").strip() if text.strip() else location
        found.append({"title": title, "text": text, "location": location, "score": item.get("score")})
    return found


def search(query: str, limit: int = 2, locale: str = "en") -> dict:
    """Returns {"documents": [{title, text, location, score}], "origin", "language"}; an empty list when
    nothing matches."""
    if locale != "fr" and config.env("KNOWLEDGE_BASE_ID"):
        return {"documents": _search_knowledge_base(query, limit), "origin": "Bedrock Knowledge Base",
                "language": "en"}
    return {"documents": _search_files(query, limit, locale), "origin": "glossary files", "language": locale}
