"""Settings read from the environment. Values are never printed or logged."""
import json
import os
from pathlib import Path

from dotenv import load_dotenv

AGENT_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = AGENT_DIR.parent

# Local runs read the repo's .env; on AgentCore the variables are set on the runtime.
load_dotenv(AGENT_DIR / ".env")
load_dotenv(REPO_DIR / ".env")

PROMPT_VERSION = "p2"


def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def region() -> str:
    return env("AWS_REGION", "us-east-1")


def orchestrator_model_id() -> str:
    return env("ORCHESTRATOR_MODEL_ID", "us.anthropic.claude-sonnet-5-5")


def subagent_model_id() -> str:
    return env("SUBAGENT_MODEL_ID", "us.anthropic.claude-haiku-5-5")


def web_url() -> str:
    return env("WEB_INTERNAL_URL", "http://localhost:3000").rstrip("/")


def glossary_dir() -> Path:
    return Path(env("GLOSSARY_DIR") or AGENT_DIR / "glossary")


def load_rules() -> dict:
    """rules/v1.json is the single place the never-words live. A missing file stops the service."""
    candidates = [env("RULES_PATH"), REPO_DIR / "rules" / "v1.json", AGENT_DIR / "rules" / "v1.json"]
    for path in candidates:
        if path and Path(path).is_file():
            return json.loads(Path(path).read_text(encoding="utf-8"))
    raise FileNotFoundError("rules/v1.json not found; set RULES_PATH")


RULES = load_rules()
NEVER_WORDS: list[str] = RULES["reasons"]["never_words"]
MAX_GUARDRAIL_FAILURES: int = RULES["agent"]["guardrail_failures_before_safe_refusal"]
