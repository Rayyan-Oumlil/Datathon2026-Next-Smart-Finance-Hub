"""The vetted glossary: Bedrock Knowledge Base when KNOWLEDGE_BASE_ID is set, else the markdown files."""
import re

from . import bedrock, config


def _words(text: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]+", text.lower()))


def _search_files(query: str, limit: int) -> list[dict]:
    wanted = _words(query)
    found = []
    for path in sorted(config.glossary_dir().glob("*.md")):
        text = path.read_text(encoding="utf-8").strip()
        title = text.splitlines()[0].lstrip("# ").strip()
        # A word of the query in the title or file name counts three times a word in the body.
        score = 3 * len(wanted & (_words(title) | _words(path.stem))) + len(wanted & _words(text))
        if score:
            found.append({"title": title, "text": text, "location": f"agent/glossary/{path.name}", "score": score})
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


def search(query: str, limit: int = 2) -> dict:
    """Returns {"documents": [{title, text, location, score}]}; an empty list when nothing matches."""
    if config.env("KNOWLEDGE_BASE_ID"):
        return {"documents": _search_knowledge_base(query, limit), "origin": "Bedrock Knowledge Base"}
    return {"documents": _search_files(query, limit), "origin": "glossary files"}
