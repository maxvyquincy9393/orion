"""
groq_engine.py

Groq engine implementation for Orion.
Uses the Groq Python SDK with API key authentication from AuthManager.
Part of Orion - Persistent AI Companion System.
"""

from __future__ import annotations

import logging
from typing import Iterator

import config
from engines.auth.manager import get_auth_manager
from engines.base import BaseEngine

_log = logging.getLogger("orion.engines.groq")
_handler = logging.FileHandler(config.LOGS_DIR / "engines.log")
_handler.setFormatter(logging.Formatter("%(asctime)s  %(levelname)-8s  %(message)s"))
_log.addHandler(_handler)
_log.setLevel(getattr(logging, config.LOG_LEVEL, logging.INFO))


class GroqEngine(BaseEngine):
    """LLM engine for Groq-hosted models."""

    def __init__(self, model: str = "llama-3.3-70b-versatile") -> None:
        """
        Initialize the Groq engine.

        Args:
            model: Default Groq model.
        """
        self.model = model
        self.auth_manager = get_auth_manager()
        self._client = None
        self._client_key = ""

    def get_name(self) -> str:
        """Return the engine name identifier."""
        return "groq"

    def _get_api_key(self) -> str:
        """
        Resolve Groq API key from AuthManager.

        Returns:
            Groq API key string.

        Raises:
            RuntimeError: If Groq API key is not configured.
        """
        token = self.auth_manager.get_token("groq")
        if not token:
            raise RuntimeError("Groq is not configured. Set GROQ_API_KEY.")

        token = token.strip()
        if token.startswith("Bearer "):
            token = token[len("Bearer ") :].strip()

        if not token:
            raise RuntimeError("Groq credential is invalid.")

        return token

    def _get_client(self, api_key: str):
        """
        Create or reuse Groq client.

        Args:
            api_key: Groq API key.

        Returns:
            Groq client instance.
        """
        if self._client is not None and self._client_key == api_key:
            return self._client

        from groq import Groq

        self._client = Groq(api_key=api_key)
        self._client_key = api_key
        return self._client

    def generate(self, prompt: str, context: list[dict]) -> str:
        """
        Generate a complete response from Groq.

        Args:
            prompt: User prompt.
            context: Prior context messages.

        Returns:
            Response text.
        """
        try:
            api_key = self._get_api_key()
        except RuntimeError as exc:
            return f"[Error] {exc}"

        client = self._get_client(api_key)
        messages = self.format_messages(prompt, context)

        try:
            response = client.chat.completions.create(
                model=self.model,
                messages=messages,
            )
            result = response.choices[0].message.content or ""
            _log.info("Groq generate: %d chars returned", len(result))
            return result
        except Exception as exc:
            _log.error("Groq generate error: %s", exc)
            return f"[Error] Groq API error: {exc}"

    def stream(self, prompt: str, context: list[dict]) -> Iterator[str]:
        """
        Stream a response from Groq.

        Args:
            prompt: User prompt.
            context: Prior context messages.

        Yields:
            Response chunks.
        """
        try:
            api_key = self._get_api_key()
        except RuntimeError as exc:
            yield f"[Error] {exc}"
            return

        client = self._get_client(api_key)
        messages = self.format_messages(prompt, context)

        try:
            stream = client.chat.completions.create(
                model=self.model,
                messages=messages,
                stream=True,
            )
            for chunk in stream:
                if chunk.choices and chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content
        except Exception as exc:
            _log.error("Groq stream error: %s", exc)
            yield f"[Error] Groq API error: {exc}"

    def is_available(self) -> bool:
        """
        Check if Groq credentials are configured and endpoint is reachable.

        Returns:
            True if Groq is usable, otherwise False.
        """
        try:
            api_key = self._get_api_key()
            client = self._get_client(api_key)
            client.models.list()
            return True
        except Exception:
            return False
