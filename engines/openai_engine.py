"""
openai_engine.py

GPT-4o engine implementation using OAuth2 authentication.
Connects to OpenAI's API using tokens managed by auth/token_manager.py.
Part of Orion — Persistent AI Companion System.
"""

from typing import Iterator
from engines.base import BaseEngine


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

    def generate(self, prompt: str, context: list[dict]) -> str:
        """
        Generate a complete response from GPT-4o.

        Args:
            prompt: The user's message or instruction.
            context: A list of prior message dicts (role, content).

        Returns:
            The full response string from GPT-4o.

        Example:
            response = engine.generate("Explain OAuth2", context)
        """
        raise NotImplementedError

    def stream(self, prompt: str, context: list[dict]) -> Iterator[str]:
        """
        Stream a response from GPT-4o token by token.

        Args:
            prompt: The user's message or instruction.
            context: A list of prior message dicts (role, content).

        Yields:
            String chunks of the response as they arrive.

        Example:
            for chunk in engine.stream("Explain OAuth2", context):
                print(chunk, end="")
        """
        raise NotImplementedError

    def is_available(self) -> bool:
        """
        Check if the OpenAI engine is available (valid token, API reachable).

        Returns:
            True if GPT-4o can accept requests, False otherwise.

        Example:
            if engine.is_available():
                response = engine.generate(prompt, context)
        """
        raise NotImplementedError
