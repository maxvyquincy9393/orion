"""
local_engine.py

Ollama local model engine implementation.
Runs entirely on localhost — no API keys or OAuth required.
Connects to the Ollama service at http://localhost:11434.
Part of Orion — Persistent AI Companion System.
"""

from typing import Iterator
from engines.base import BaseEngine


class LocalEngine(BaseEngine):
    """
    LLM engine for Ollama local models.
    No authentication required — runs on localhost.
    Best suited for: fast responses, offline use, privacy-sensitive tasks.
    """

    def __init__(self, model: str = "llama3", base_url: str = "http://localhost:11434") -> None:
        """
        Initialize the local Ollama engine.

        Args:
            model: The Ollama model to use. Defaults to "llama3".
            base_url: The Ollama API base URL. Defaults to "http://localhost:11434".
        """
        self.model = model
        self.base_url = base_url

    def generate(self, prompt: str, context: list[dict]) -> str:
        """
        Generate a complete response from the local Ollama model.

        Args:
            prompt: The user's message or instruction.
            context: A list of prior message dicts (role, content).

        Returns:
            The full response string from the local model.

        Example:
            response = engine.generate("Quick question", context)
        """
        raise NotImplementedError

    def stream(self, prompt: str, context: list[dict]) -> Iterator[str]:
        """
        Stream a response from the local Ollama model token by token.

        Args:
            prompt: The user's message or instruction.
            context: A list of prior message dicts (role, content).

        Yields:
            String chunks of the response as they arrive.

        Example:
            for chunk in engine.stream("Quick question", context):
                print(chunk, end="")
        """
        raise NotImplementedError

    def is_available(self) -> bool:
        """
        Check if Ollama is running and the specified model is loaded.

        Returns:
            True if the local engine can accept requests, False otherwise.

        Example:
            if engine.is_available():
                response = engine.generate(prompt, context)
        """
        raise NotImplementedError
