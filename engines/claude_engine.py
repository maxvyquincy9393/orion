"""
claude_engine.py

Anthropic Claude engine implementation using API key authentication.
Connects to the Anthropic API for complex reasoning and analysis tasks.
Part of Orion — Persistent AI Companion System.
"""

import logging
from typing import Iterator

import config
from engines.base import BaseEngine

_log = logging.getLogger("orion.engines.claude")
_handler = logging.FileHandler(config.LOGS_DIR / "engines.log")
_handler.setFormatter(logging.Formatter("%(asctime)s  %(levelname)-8s  %(message)s"))
_log.addHandler(_handler)
_log.setLevel(getattr(logging, config.LOG_LEVEL, logging.INFO))


class ClaudeEngine(BaseEngine):
    """
    LLM engine for Anthropic Claude.
    Uses API key authentication (stored in .env as ANTHROPIC_API_KEY).
    Best suited for: deep reasoning, analysis, long-form content.
    """

    def __init__(self, model: str = "claude-sonnet-4-20250514") -> None:
        """
        Initialize the Claude engine.

        Args:
            model: The Anthropic model to use. Defaults to "claude-sonnet-4-20250514".
        """
        self.model = model
        self._client = None

    def _get_client(self):
        """
        Lazily create the Anthropic client using API key.

        Returns:
            Anthropic client instance or None if unavailable.
        """
        if self._client is not None:
            return self._client

        api_key = config.ANTHROPIC_API_KEY
        if not api_key:
            _log.debug("Anthropic API key not configured")
            return None

        try:
            from anthropic import Anthropic

            self._client = Anthropic(api_key=api_key)
            _log.info("Anthropic client initialised")
            return self._client
        except Exception as exc:
            _log.error("Failed to initialise Anthropic client: %s", exc)
            return None

    def get_name(self) -> str:
        """Return the engine name identifier."""
        return "claude"

    def generate(self, prompt: str, context: list[dict]) -> str:
        """
        Generate a complete response from Claude.

        Args:
            prompt: The user's message or instruction.
            context: A list of prior message dicts (role, content).

        Returns:
            The full response string from Claude.
        """
        client = self._get_client()
        if client is None:
            return "[Error] Claude engine unavailable: no API key configured"

        messages = self.format_messages(prompt, context)

        system_content = None
        filtered_messages = []
        for msg in messages:
            if msg["role"] == "system":
                system_content = msg["content"]
            else:
                filtered_messages.append(msg)

        try:
            kwargs = {
                "model": self.model,
                "max_tokens": 4096,
                "messages": filtered_messages,
            }
            if system_content:
                kwargs["system"] = system_content

            response = client.messages.create(**kwargs)
            result = response.content[0].text if response.content else ""
            _log.info("Claude generate: %d chars returned", len(result))
            return result
        except Exception as exc:
            _log.error("Claude generate error: %s", exc)
            return f"[Error] Claude API error: {exc}"

    def stream(self, prompt: str, context: list[dict]) -> Iterator[str]:
        """
        Stream a response from Claude token by token.

        Args:
            prompt: The user's message or instruction.
            context: A list of prior message dicts (role, content).

        Yields:
            String chunks of the response as they arrive.
        """
        client = self._get_client()
        if client is None:
            yield "[Error] Claude engine unavailable: no API key configured"
            return

        messages = self.format_messages(prompt, context)

        system_content = None
        filtered_messages = []
        for msg in messages:
            if msg["role"] == "system":
                system_content = msg["content"]
            else:
                filtered_messages.append(msg)

        try:
            kwargs = {
                "model": self.model,
                "max_tokens": 4096,
                "messages": filtered_messages,
            }
            if system_content:
                kwargs["system"] = system_content

            with client.messages.stream(**kwargs) as stream:
                for text in stream.text_stream:
                    yield text
        except Exception as exc:
            _log.error("Claude stream error: %s", exc)
            yield f"[Error] Claude API error: {exc}"

    def is_available(self) -> bool:
        """
        Check if the Claude engine is available (valid API key, API reachable).

        Returns:
            True if Claude can accept requests, False otherwise.
        """
        client = self._get_client()
        if client is None:
            return False

        try:
            client.messages.create(
                model=self.model,
                max_tokens=1,
                messages=[{"role": "user", "content": "ping"}],
            )
            _log.debug("Claude engine is available")
            return True
        except Exception as exc:
            error_str = str(exc).lower()
            if "rate" in error_str or "limit" in error_str:
                _log.debug("Claude rate limited but available")
                return True
            _log.warning("Claude availability check failed: %s", exc)
            return False
