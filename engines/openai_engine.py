"""
openai_engine.py

GPT-4o engine implementation using OAuth2 authentication.
Connects to OpenAI's API using tokens managed by auth/token_manager.py.
Part of Orion — Persistent AI Companion System.
"""

import logging
from typing import Iterator

import config
from engines.base import BaseEngine

_log = logging.getLogger("orion.engines.openai")
_handler = logging.FileHandler(config.LOGS_DIR / "engines.log")
_handler.setFormatter(logging.Formatter("%(asctime)s  %(levelname)-8s  %(message)s"))
_log.addHandler(_handler)
_log.setLevel(getattr(logging, config.LOG_LEVEL, logging.INFO))


class OpenAIEngine(BaseEngine):
    """
    LLM engine for OpenAI GPT-4o.
    Uses OAuth2 tokens for authentication instead of API keys.
    Best suited for: reasoning, code generation, multimodal tasks.
    """

    def __init__(self, model: str = "gpt-4o") -> None:
        """
        Initialize the OpenAI engine.

        Args:
            model: The OpenAI model to use. Defaults to "gpt-4o".
        """
        self.model = model
        self._client = None

    def _get_client(self):
        """
        Lazily create the OpenAI client using OAuth token.

        Returns:
            OpenAI client instance or None if unavailable.
        """
        if self._client is not None:
            return self._client

        token = config.OPENAI_ACCESS_TOKEN
        if not token:
            _log.debug("OpenAI access token not configured")
            return None

        try:
            from openai import OpenAI

            self._client = OpenAI(api_key=token)
            _log.info("OpenAI client initialised with OAuth token")
            return self._client
        except Exception as exc:
            _log.error("Failed to initialise OpenAI client: %s", exc)
            return None

    def get_name(self) -> str:
        """Return the engine name identifier."""
        return "openai"

    def generate(self, prompt: str, context: list[dict]) -> str:
        """
        Generate a complete response from GPT-4o.

        Args:
            prompt: The user's message or instruction.
            context: A list of prior message dicts (role, content).

        Returns:
            The full response string from GPT-4o.
        """
        client = self._get_client()
        if client is None:
            return "[Error] OpenAI engine unavailable: no valid token"

        messages = self.format_messages(prompt, context)

        try:
            response = client.chat.completions.create(
                model=self.model,
                messages=messages,
            )
            result = response.choices[0].message.content or ""
            _log.info("OpenAI generate: %d chars returned", len(result))
            return result
        except Exception as exc:
            _log.error("OpenAI generate error: %s", exc)
            return f"[Error] OpenAI API error: {exc}"

    def stream(self, prompt: str, context: list[dict]) -> Iterator[str]:
        """
        Stream a response from GPT-4o token by token.

        Args:
            prompt: The user's message or instruction.
            context: A list of prior message dicts (role, content).

        Yields:
            String chunks of the response as they arrive.
        """
        client = self._get_client()
        if client is None:
            yield "[Error] OpenAI engine unavailable: no valid token"
            return

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
            _log.error("OpenAI stream error: %s", exc)
            yield f"[Error] OpenAI API error: {exc}"

    def is_available(self) -> bool:
        """
        Check if the OpenAI engine is available (valid token, API reachable).

        Returns:
            True if GPT-4o can accept requests, False otherwise.
        """
        client = self._get_client()
        if client is None:
            return False

        try:
            client.models.list()
            _log.debug("OpenAI engine is available")
            return True
        except Exception as exc:
            _log.warning("OpenAI availability check failed: %s", exc)
            return False
