"""
claude_engine.py

Anthropic Claude engine implementation using API key authentication.
Connects to the Anthropic API for complex reasoning and analysis tasks.
Part of Orion — Persistent AI Companion System.
"""

from typing import Iterator
from engines.base import BaseEngine


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

    def generate(self, prompt: str, context: list[dict]) -> str:
        """
        Generate a complete response from Claude.

        Args:
            prompt: The user's message or instruction.
            context: A list of prior message dicts (role, content).

        Returns:
            The full response string from Claude.

        Example:
            response = engine.generate("Analyze this architecture", context)
        """
        raise NotImplementedError

    def stream(self, prompt: str, context: list[dict]) -> Iterator[str]:
        """
        Stream a response from Claude token by token.

        Args:
            prompt: The user's message or instruction.
            context: A list of prior message dicts (role, content).

        Yields:
            String chunks of the response as they arrive.

        Example:
            for chunk in engine.stream("Analyze this", context):
                print(chunk, end="")
        """
        raise NotImplementedError

    def is_available(self) -> bool:
        """
        Check if the Claude engine is available (valid API key, API reachable).

        Returns:
            True if Claude can accept requests, False otherwise.

        Example:
            if engine.is_available():
                response = engine.generate(prompt, context)
        """
        raise NotImplementedError
