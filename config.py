"""
config.py

Loads all environment variables from .env using python-dotenv.
Exposes them as typed constants grouped by section.
Validates required keys on import — raises clear errors if missing.
Part of Orion — Persistent AI Companion System.
"""

import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# Load .env file from project root
# ---------------------------------------------------------------------------
_ENV_PATH = Path(__file__).resolve().parent / ".env"
load_dotenv(_ENV_PATH)


def _get_required(key: str) -> str:
    """
    Retrieve a required environment variable.

    Args:
        key: The environment variable name.

    Returns:
        The value string.

    Raises:
        SystemExit: If the variable is not set or empty.
    """
    value = os.getenv(key, "").strip()
    if not value:
        print(
            f"[Orion Config Error] Required environment variable '{key}' is missing or empty.\n"
            f"  → Add it to your .env file. See .env.example for reference.",
            file=sys.stderr,
        )
        raise SystemExit(1)
    return value


def _get_optional(key: str, default: str = "") -> str:
    """
    Retrieve an optional environment variable with a default.

    Args:
        key: The environment variable name.
        default: Fallback value if not set.

    Returns:
        The value string or default.
    """
    return os.getenv(key, default).strip() or default


def _get_bool(key: str, default: bool = False) -> bool:
    """
    Retrieve an environment variable as a boolean.

    Args:
        key: The environment variable name.
        default: Fallback if not set.

    Returns:
        True if the value is "true"/"1"/"yes" (case-insensitive), else False.
    """
    raw = os.getenv(key, "").strip().lower()
    if not raw:
        return default
    return raw in ("true", "1", "yes")


def _get_int(key: str, default: int = 0) -> int:
    """
    Retrieve an environment variable as an integer.

    Args:
        key: The environment variable name.
        default: Fallback if not set or not a valid int.

    Returns:
        The integer value.
    """
    raw = os.getenv(key, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _get_float(key: str, default: float = 0.0) -> float:
    """
    Retrieve an environment variable as a float.

    Args:
        key: The environment variable name.
        default: Fallback if not set or not a valid float.

    Returns:
        The float value.
    """
    raw = os.getenv(key, "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


# ===========================================================================
# Section 1 — LLM Keys & Auth
# ===========================================================================

# OpenAI (OAuth2) — optional until auth flow is run
OPENAI_ACCESS_TOKEN: str = _get_optional("OPENAI_ACCESS_TOKEN")
OPENAI_REFRESH_TOKEN: str = _get_optional("OPENAI_REFRESH_TOKEN")
OPENAI_CLIENT_ID: str = _get_optional("OPENAI_CLIENT_ID")
OPENAI_CLIENT_SECRET: str = _get_optional("OPENAI_CLIENT_SECRET")

# Google Gemini (OAuth2) — optional until auth flow is run
GOOGLE_ACCESS_TOKEN: str = _get_optional("GOOGLE_ACCESS_TOKEN")
GOOGLE_REFRESH_TOKEN: str = _get_optional("GOOGLE_REFRESH_TOKEN")
GOOGLE_CLIENT_ID: str = _get_optional("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET: str = _get_optional("GOOGLE_CLIENT_SECRET")

# Anthropic Claude — API key
ANTHROPIC_API_KEY: str = _get_optional("ANTHROPIC_API_KEY")

# Ollama — local, free, always available
OLLAMA_BASE_URL: str = _get_optional("OLLAMA_BASE_URL", "http://localhost:11434")

# ===========================================================================
# Section 2 — Database
# ===========================================================================

DATABASE_URL: str = _get_optional(
    "DATABASE_URL", "postgresql://user:password@localhost:5432/orion"
)
SUPABASE_URL: str = _get_optional("SUPABASE_URL")
SUPABASE_KEY: str = _get_optional("SUPABASE_KEY")

# ===========================================================================
# Section 3 — Search (free)
# ===========================================================================

SEARXNG_URL: str = _get_optional("SEARXNG_URL", "http://localhost:8888")
DUCKDUCKGO_ENABLED: bool = _get_bool("DUCKDUCKGO_ENABLED", default=True)

# ===========================================================================
# Section 4 — Delivery
# ===========================================================================

TELEGRAM_BOT_TOKEN: str = _get_optional("TELEGRAM_BOT_TOKEN")

# ===========================================================================
# Section 5 — Voice (free local options)
# ===========================================================================

WHISPER_MODEL: str = _get_optional("WHISPER_MODEL", "base")
TTS_ENGINE: str = _get_optional("TTS_ENGINE", "coqui")  # coqui | elevenlabs
ELEVENLABS_API_KEY: str = _get_optional("ELEVENLABS_API_KEY")

# ===========================================================================
# Section 6 — Vision
# ===========================================================================

VISION_ENGINE: str = _get_optional("VISION_ENGINE", "gemini")  # gemini | openai
VISION_MODE: str = _get_optional("VISION_MODE", "passive")     # passive | active | on-demand | screen
FRAME_SAMPLE_INTERVAL: int = _get_int("FRAME_SAMPLE_INTERVAL", 2)
MOTION_THRESHOLD: float = _get_float("MOTION_THRESHOLD", 0.15)

# ===========================================================================
# Section 7 — Background
# ===========================================================================

REDIS_URL: str = _get_optional("REDIS_URL", "redis://localhost:6379")

# ===========================================================================
# Section 8 — General Config
# ===========================================================================

DEFAULT_ENGINE: str = _get_optional("DEFAULT_ENGINE", "claude")
DEFAULT_USER_ID: str = _get_optional("DEFAULT_USER_ID", "owner")
PERMISSIONS_CONFIG: str = _get_optional(
    "PERMISSIONS_CONFIG", "permissions/permissions.yaml"
)
LOG_LEVEL: str = _get_optional("LOG_LEVEL", "INFO")

# ===========================================================================
# Project paths (derived, not from .env)
# ===========================================================================

PROJECT_ROOT: Path = Path(__file__).resolve().parent
LOGS_DIR: Path = PROJECT_ROOT / "logs"
PERMISSIONS_YAML_PATH: Path = PROJECT_ROOT / PERMISSIONS_CONFIG

# Ensure logs directory exists
LOGS_DIR.mkdir(exist_ok=True)


# ===========================================================================
# Validation helpers
# ===========================================================================

def validate_required_for_engine(engine: str) -> None:
    """
    Validate that the required credentials exist for a given engine.
    Call this before using a specific engine — not at import time,
    because users may only need a subset of engines.

    Args:
        engine: Engine name — "openai", "claude", "gemini", or "local".

    Raises:
        SystemExit: If required credentials are missing.

    Example:
        validate_required_for_engine("claude")
    """
    checks: dict[str, list[tuple[str, str]]] = {
        "openai": [
            (OPENAI_ACCESS_TOKEN, "OPENAI_ACCESS_TOKEN"),
        ],
        "claude": [
            (ANTHROPIC_API_KEY, "ANTHROPIC_API_KEY"),
        ],
        "gemini": [
            (GOOGLE_ACCESS_TOKEN, "GOOGLE_ACCESS_TOKEN"),
        ],
        "local": [],  # Ollama needs no credentials
    }

    required = checks.get(engine, [])
    for value, name in required:
        if not value:
            print(
                f"[Orion Config Error] Engine '{engine}' requires '{name}' but it is missing.\n"
                f"  → Add it to your .env file. See .env.example for reference.",
                file=sys.stderr,
            )
            raise SystemExit(1)


def validate_delivery() -> None:
    """
    Validate that Telegram delivery is configured.

    Raises:
        SystemExit: If TELEGRAM_BOT_TOKEN is missing.

    Example:
        validate_delivery()
    """
    if not TELEGRAM_BOT_TOKEN:
        print(
            "[Orion Config Error] Delivery requires 'TELEGRAM_BOT_TOKEN' but it is missing.\n"
            "  → Add it to your .env file. See .env.example for reference.",
            file=sys.stderr,
        )
        raise SystemExit(1)


def as_dict() -> dict[str, str | int | float | bool]:
    """
    Return all configuration values as a flat dictionary.
    Useful for debugging — does NOT include sensitive tokens in logs.

    Returns:
        A dict of all config keys and their current values.

    Example:
        cfg = as_dict()
    """
    return {
        # LLM Keys (presence only — not the actual value)
        "OPENAI_ACCESS_TOKEN": "***set***" if OPENAI_ACCESS_TOKEN else "",
        "OPENAI_CLIENT_ID": "***set***" if OPENAI_CLIENT_ID else "",
        "GOOGLE_ACCESS_TOKEN": "***set***" if GOOGLE_ACCESS_TOKEN else "",
        "GOOGLE_CLIENT_ID": "***set***" if GOOGLE_CLIENT_ID else "",
        "ANTHROPIC_API_KEY": "***set***" if ANTHROPIC_API_KEY else "",
        "OLLAMA_BASE_URL": OLLAMA_BASE_URL,
        # Database
        "DATABASE_URL": DATABASE_URL,
        "SUPABASE_URL": SUPABASE_URL or "(not set)",
        "SUPABASE_KEY": "***set***" if SUPABASE_KEY else "",
        # Search
        "SEARXNG_URL": SEARXNG_URL,
        "DUCKDUCKGO_ENABLED": DUCKDUCKGO_ENABLED,
        # Delivery
        "TELEGRAM_BOT_TOKEN": "***set***" if TELEGRAM_BOT_TOKEN else "",
        # Voice
        "WHISPER_MODEL": WHISPER_MODEL,
        "TTS_ENGINE": TTS_ENGINE,
        "ELEVENLABS_API_KEY": "***set***" if ELEVENLABS_API_KEY else "",
        # Vision
        "VISION_ENGINE": VISION_ENGINE,
        "VISION_MODE": VISION_MODE,
        "FRAME_SAMPLE_INTERVAL": FRAME_SAMPLE_INTERVAL,
        "MOTION_THRESHOLD": MOTION_THRESHOLD,
        # Background
        "REDIS_URL": REDIS_URL,
        # General
        "DEFAULT_ENGINE": DEFAULT_ENGINE,
        "DEFAULT_USER_ID": DEFAULT_USER_ID,
        "PERMISSIONS_CONFIG": PERMISSIONS_CONFIG,
        "LOG_LEVEL": LOG_LEVEL,
    }
