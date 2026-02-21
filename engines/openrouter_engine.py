"""
openrouter_engine.py

OpenRouter engine implementation for Orion.
Uses OpenAI-compatible API at https://openrouter.ai/api/v1.
Part of Orion - Persistent AI Companion System.
"""

from __future__ import annotations

import logging
from typing import Iterator

import config
from engines.auth.manager import get_auth_manager
from engines.base import BaseEngine

_log = logging.getLogger("orion.engines.openrouter")
_handler = logging.FileHandler(config.LOGS_DIR / "engines.log")
_handler.setFormatter(logging.Formatter("%(asctime)s  %(levelname)-8s  %(message)s"))
_log.addHandler(_handler)
_log.setLevel(getattr(logging, config.LOG_LEVEL, logging.INFO))

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
OPENROUTER_REFERER = "https://github.com/maxvyquincy9393/orion"


class OpenRouterEngine(BaseEngine):
    """LLM engine for OpenRouter models via OpenAI-compatible API."""

    def __init__(self, model: str = "openrouter/auto") -> None:
        """
        Initialize the OpenRouter engine.

        Args:
            model: Default OpenRouter model.
        """
        self.model = model
        self.auth_manager = get_auth_manager()
        self._client = None
        self._client_key = ""

    def get_name(self) -> str:
        """Return the engine name identifier."""
        return "openrouter"

    def _get_api_key(self) -> str:
        """
        Resolve OpenRouter API key from AuthManager.

        Returns:
            OpenRouter API key string.

        Raises:
            RuntimeError: If OpenRouter API key is not configured.
        """
        token = self.auth_manager.get_token("openrouter")
        if not token:
            raise RuntimeError("OpenRouter is not configured. Set OPENROUTER_API_KEY.")

        token = token.strip()
        if token.startswith("Bearer "):
            token = token[len("Bearer ") :].strip()

        if not token:
            raise RuntimeError("OpenRouter credential is invalid.")

        return token

    def _get_client(self, api_key: str):
        """
        Create or reuse OpenRouter client.

        Args:
            api_key: OpenRouter API key.

        Returns:
            OpenAI-compatible client for OpenRouter.
        """
        if self._client is not None and self._client_key == api_key:
            return self._client

        from openai import OpenAI

        self._client = OpenAI(
            api_key=api_key,
            base_url=OPENROUTER_BASE_URL,
            default_headers={
                "HTTP-Referer": OPENROUTER_REFERER,
            },
        )
        self._client_key = api_key
        return self._client

    def generate(self, prompt: str, context: list[dict]) -> str:
        """
        Generate a complete response from OpenRouter.

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
            _log.info("OpenRouter generate: %d chars returned", len(result))
            return result
        except Exception as exc:
            _log.error("OpenRouter generate error: %s", exc)
            return f"[Error] OpenRouter API error: {exc}"

    def stream(self, prompt: str, context: list[dict]) -> Iterator[str]:
        """
        Stream a response from OpenRouter.

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
            _log.error("OpenRouter stream error: %s", exc)
            yield f"[Error] OpenRouter API error: {exc}"

    def is_available(self) -> bool:
        """
        Check if OpenRouter credentials are configured and endpoint is reachable.

        Returns:
            True if OpenRouter is usable, otherwise False.
        """
        try:
            api_key = self._get_api_key()
            client = self._get_client(api_key)
            client.models.list()
            return True
        except Exception:
            return False
