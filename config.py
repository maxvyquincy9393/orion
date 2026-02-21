"""
config.py

Loads all environment variables, API keys, and configuration settings
from .env file and system environment. Central configuration for all
Orion modules.
Part of Orion — Persistent AI Companion System.
"""

import os
from typing import Optional
from dotenv import load_dotenv


def load_config() -> dict:
    """
    Load all configuration from .env file and environment variables.

    Returns:
        A dict containing all configuration key-value pairs.

    Example:
        config = load_config()
        db_url = config["DATABASE_URL"]
    """
    load_dotenv()

    return {
        # OpenAI — OAuth2
        "OPENAI_ACCESS_TOKEN": os.getenv("OPENAI_ACCESS_TOKEN", ""),
        "OPENAI_REFRESH_TOKEN": os.getenv("OPENAI_REFRESH_TOKEN", ""),
        "OPENAI_CLIENT_ID": os.getenv("OPENAI_CLIENT_ID", ""),
        "OPENAI_CLIENT_SECRET": os.getenv("OPENAI_CLIENT_SECRET", ""),

        # Google Gemini — OAuth2
        "GOOGLE_ACCESS_TOKEN": os.getenv("GOOGLE_ACCESS_TOKEN", ""),
        "GOOGLE_REFRESH_TOKEN": os.getenv("GOOGLE_REFRESH_TOKEN", ""),
        "GOOGLE_CLIENT_ID": os.getenv("GOOGLE_CLIENT_ID", ""),
        "GOOGLE_CLIENT_SECRET": os.getenv("GOOGLE_CLIENT_SECRET", ""),

        # Anthropic — API Key
        "ANTHROPIC_API_KEY": os.getenv("ANTHROPIC_API_KEY", ""),

        # Ollama — Local
        "OLLAMA_BASE_URL": os.getenv("OLLAMA_BASE_URL", "http://localhost:11434"),

        # Database
        "DATABASE_URL": os.getenv("DATABASE_URL", "postgresql://user:password@localhost:5432/orion"),
        "PINECONE_API_KEY": os.getenv("PINECONE_API_KEY", ""),
        "SUPABASE_URL": os.getenv("SUPABASE_URL", ""),
        "SUPABASE_KEY": os.getenv("SUPABASE_KEY", ""),

        # Delivery
        "TELEGRAM_BOT_TOKEN": os.getenv("TELEGRAM_BOT_TOKEN", ""),
        "WHATSAPP_API_KEY": os.getenv("WHATSAPP_API_KEY", ""),

        # Voice
        "ELEVENLABS_API_KEY": os.getenv("ELEVENLABS_API_KEY", ""),

        # Background
        "REDIS_URL": os.getenv("REDIS_URL", "redis://localhost:6379"),

        # Config
        "DEFAULT_ENGINE": os.getenv("DEFAULT_ENGINE", "claude"),
        "DEFAULT_USER_ID": os.getenv("DEFAULT_USER_ID", "owner"),
        "LOG_LEVEL": os.getenv("LOG_LEVEL", "INFO"),
    }


def get(key: str, default: Optional[str] = None) -> Optional[str]:
    """
    Get a single configuration value by key.

    Args:
        key: The configuration key to look up.
        default: Default value if the key is not found.

    Returns:
        The configuration value string, or default.

    Example:
        engine = get("DEFAULT_ENGINE", "claude")
    """
    config = load_config()
    return config.get(key, default)
