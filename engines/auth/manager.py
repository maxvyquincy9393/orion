"""
manager.py

Centralized provider authentication manager for Orion.
Resolves OAuth tokens, API keys, and local provider availability.
Part of Orion - Persistent AI Companion System.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

import requests
from dotenv import load_dotenv

from engines.auth import oauth_gemini
from engines.auth import oauth_openai

PROJECT_ROOT = Path(__file__).resolve().parents[2]
LOGS_DIR = PROJECT_ROOT / "logs"
LOG_FILE = LOGS_DIR / "auth.log"

LOGS_DIR.mkdir(parents=True, exist_ok=True)
load_dotenv(PROJECT_ROOT / ".env")

_log = logging.getLogger("orion.auth.manager")
if not _log.handlers:
    _handler = logging.FileHandler(LOG_FILE, encoding="utf-8")
    _handler.setFormatter(
        logging.Formatter("[%(asctime)s] [%(levelname)s] [auth.manager] %(message)s")
    )
    _log.addHandler(_handler)
    _log.setLevel(logging.INFO)
    _log.propagate = False


class AuthManager:
    """
    Central manager for all auth providers used by Orion.

    Supports OAuth-backed providers, API-key providers, and local engines.
    """

    def _env(self, key: str) -> str:
        """Read an environment variable as a stripped string."""
        return os.getenv(key, "").strip()

    def _is_ollama_reachable(self) -> bool:
        """Return True if Ollama localhost endpoint responds within 2 seconds."""
        try:
            response = requests.get("http://localhost:11434", timeout=2)
            return response.status_code < 500
        except requests.RequestException:
            return False

    def get_token(self, provider: str) -> str | None:
        """
        Resolve a credential token for the requested provider.

        Args:
            provider: Provider name.

        Returns:
            A token string if available, otherwise None.
        """
        normalized = provider.lower().strip()
        _log.info("Resolving token for provider '%s'", normalized)

        if normalized == "openai":
            oauth_token = oauth_openai.get_token()
            if oauth_token:
                return f"Bearer {oauth_token}"
            api_key = self._env("OPENAI_API_KEY")
            return api_key or None

        if normalized == "gemini":
            oauth_token = oauth_gemini.get_token()
            if oauth_token:
                return f"Bearer {oauth_token}"
            api_key = self._env("GEMINI_API_KEY")
            return api_key or None

        if normalized in {"anthropic", "claude"}:
            api_key = self._env("ANTHROPIC_API_KEY")
            return api_key or None

        if normalized == "openrouter":
            api_key = self._env("OPENROUTER_API_KEY")
            return api_key or None

        if normalized == "groq":
            api_key = self._env("GROQ_API_KEY")
            return api_key or None

        if normalized == "mistral":
            api_key = self._env("MISTRAL_API_KEY")
            return api_key or None

        if normalized in {"ollama", "local"}:
            return "local"

        _log.warning("Unknown provider requested for token resolution: %s", provider)
        return None

    def get_available_providers(self) -> list[str]:
        """
        Return providers that currently have valid auth or local connectivity.

        Returns:
            List of available provider names.
        """
        available: list[str] = []

        if self._env("ANTHROPIC_API_KEY"):
            available.append("anthropic")

        if oauth_openai.is_logged_in() or self._env("OPENAI_API_KEY"):
            available.append("openai")

        if oauth_gemini.is_logged_in() or self._env("GEMINI_API_KEY"):
            available.append("gemini")

        if self._env("OPENROUTER_API_KEY"):
            available.append("openrouter")

        if self._env("GROQ_API_KEY"):
            available.append("groq")

        if self._env("MISTRAL_API_KEY"):
            available.append("mistral")

        if self._is_ollama_reachable():
            available.append("ollama")
            available.append("local")

        _log.info("Available providers: %s", available)
        return available

    def get_provider_status(self) -> dict[str, dict]:
        """
        Return provider status metadata for all supported providers.

        Returns:
            Dict of provider status records.
        """
        openai_oauth = oauth_openai.is_logged_in()
        openai_api = bool(self._env("OPENAI_API_KEY"))

        gemini_oauth = oauth_gemini.is_logged_in()
        gemini_api = bool(self._env("GEMINI_API_KEY"))

        ollama_available = self._is_ollama_reachable()

        status = {
            "anthropic": {
                "available": bool(self._env("ANTHROPIC_API_KEY")),
                "auth_type": "api_key",
                "model": "claude-opus-4-6",
            },
            "openai": {
                "available": openai_oauth or openai_api,
                "auth_type": "oauth" if openai_oauth else "api_key",
                "model": "gpt-5.2",
            },
            "gemini": {
                "available": gemini_oauth or gemini_api,
                "auth_type": "oauth" if gemini_oauth else "api_key",
                "model": "gemini-3.1-pro",
            },
            "openrouter": {
                "available": bool(self._env("OPENROUTER_API_KEY")),
                "auth_type": "api_key",
                "model": "openrouter/auto",
            },
            "groq": {
                "available": bool(self._env("GROQ_API_KEY")),
                "auth_type": "api_key",
                "model": "llama-3.3-70b",
            },
            "mistral": {
                "available": bool(self._env("MISTRAL_API_KEY")),
                "auth_type": "api_key",
                "model": "mistral-large",
            },
            "ollama": {
                "available": ollama_available,
                "auth_type": "local",
                "model": "auto-detect",
            },
        }

        _log.info("Provider status computed")
        return status

    def login_provider(self, provider: str) -> bool:
        """
        Start login flow for OAuth-capable providers.

        Args:
            provider: Provider name.

        Returns:
            True if login succeeds, otherwise False.
        """
        normalized = provider.lower().strip()
        _log.info("Login requested for provider '%s'", normalized)

        if normalized == "openai":
            return bool(oauth_openai.login())

        if normalized == "gemini":
            return bool(oauth_gemini.login())

        print("Use API key instead")
        _log.info("Login not supported for provider '%s'", normalized)
        return False

    def logout_provider(self, provider: str) -> None:
        """
        Logout provider and clear local OAuth credentials where applicable.

        Args:
            provider: Provider name.
        """
        normalized = provider.lower().strip()
        _log.info("Logout requested for provider '%s'", normalized)

        if normalized == "openai":
            oauth_openai.logout()
            return

        if normalized == "gemini":
            oauth_gemini.logout()
            return

        _log.info("No logout operation for provider '%s'", normalized)


_auth_manager_singleton: AuthManager | None = None


def get_auth_manager() -> AuthManager:
    """Return a shared AuthManager instance."""
    global _auth_manager_singleton
    if _auth_manager_singleton is None:
        _auth_manager_singleton = AuthManager()
    return _auth_manager_singleton
