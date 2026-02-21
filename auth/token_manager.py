"""
token_manager.py

Centralized token storage and auto-refresh for all LLM providers.
Manages tokens for OpenAI (OAuth2), Google (OAuth2), and Anthropic (API key).
Automatically refreshes tokens before they expire.
Part of Orion — Persistent AI Companion System.
"""

from typing import Optional


def get_token(provider: str) -> str:
    """
    Retrieve the current valid access token for a given provider.
    Automatically refreshes the token if it has expired.

    Args:
        provider: The provider name — "openai", "google", or "anthropic".

    Returns:
        A valid access token or API key string.

    Example:
        token = get_token("openai")
    """
    raise NotImplementedError


def save_token(provider: str, token_data: dict) -> None:
    """
    Save token data for a given provider to persistent storage.

    Args:
        provider: The provider name — "openai", "google", or "anthropic".
        token_data: A dict containing access_token, refresh_token, expires_at, etc.

    Returns:
        None

    Example:
        save_token("openai", {"access_token": "...", "refresh_token": "..."})
    """
    raise NotImplementedError


def refresh_token(provider: str) -> str:
    """
    Force-refresh the access token for a given provider.

    Args:
        provider: The provider name — "openai" or "google".

    Returns:
        The new access token string.

    Example:
        new_token = refresh_token("google")
    """
    raise NotImplementedError


def is_expired(provider: str) -> bool:
    """
    Check if the current token for a provider has expired.

    Args:
        provider: The provider name — "openai", "google", or "anthropic".

    Returns:
        True if the token is expired or missing, False if still valid.

    Example:
        if is_expired("openai"):
            refresh_token("openai")
    """
    raise NotImplementedError
