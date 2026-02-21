"""
gemini_engine.py

Google Gemini engine implementation using OAuth2 authentication.
Connects to the Google Generative AI API using tokens managed by auth/token_manager.py.
Part of Orion — Persistent AI Companion System.
"""

from typing import Iterator
from engines.base import BaseEngine


class GeminiEngine(BaseEngine):
    """
    LLM engine for Google Gemini.
    Uses OAuth2 tokens for authentication.
    Best suited for: multimodal tasks, fast generation, Google ecosystem integration.
    """

    def __init__(self, model: str = "gemini-pro") -> None:
        """
        Initialize the Gemini engine.

        Args:
            model: The Google Gemini model to use. Defaults to "gemini-pro".
        """
        self.model = model

    def generate(self, prompt: str, context: list[dict]) -> str:
        """
        Generate a complete response from Gemini.

        Args:
            prompt: The user's message or instruction.
            context: A list of prior message dicts (role, content).

        Returns:
            The full response string from Gemini.

        Example:
            response = engine.generate("Describe this image", context)
        """
        raise NotImplementedError

    def stream(self, prompt: str, context: list[dict]) -> Iterator[str]:
        """
        Stream a response from Gemini token by token.

        Args:
            prompt: The user's message or instruction.
            context: A list of prior message dicts (role, content).

        Yields:
            String chunks of the response as they arrive.

        Example:
            for chunk in engine.stream("Describe this image", context):
                print(chunk, end="")
        """
        raise NotImplementedError

    def is_available(self) -> bool:
        """
        Check if the Gemini engine is available (valid token, API reachable).

        Returns:
            True if Gemini can accept requests, False otherwise.

        Example:
            if engine.is_available():
                response = engine.generate(prompt, context)
        """
        raise NotImplementedError
