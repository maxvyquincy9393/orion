"""
base.py

Abstract base class that all LLM engines must implement.
Defines the standard interface for generating responses, streaming,
and health checks across all providers.
Part of Orion — Persistent AI Companion System.
"""

from abc import ABC, abstractmethod
from typing import Iterator


class BaseEngine(ABC):
    """
    Abstract base class for all LLM engines in Orion.

    Every engine (OpenAI, Claude, Gemini, Ollama) must subclass this
    and implement all abstract methods to ensure a consistent interface
    for the orchestrator.

    Example:
        class MyEngine(BaseEngine):
            def generate(self, prompt, context):
                return "response"
            def stream(self, prompt, context):
                yield "chunk"
            def is_available(self):
                return True
    """

    @abstractmethod
    def generate(self, prompt: str, context: list[dict]) -> str:
        """
        Generate a complete response from the LLM.

        Args:
            prompt: The user's message or instruction.
            context: A list of prior message dicts (role, content).

        Returns:
            The full response string from the LLM.

        Example:
            response = engine.generate("Explain OAuth2", [{"role": "system", "content": "..."}])
        """
        ...

    @abstractmethod
    def stream(self, prompt: str, context: list[dict]) -> Iterator[str]:
        """
        Stream a response from the LLM token by token.

        Args:
            prompt: The user's message or instruction.
            context: A list of prior message dicts (role, content).

        Yields:
            String chunks of the response as they arrive.

        Example:
            for chunk in engine.stream("Explain OAuth2", context):
                print(chunk, end="")
        """
        ...

    @abstractmethod
    def is_available(self) -> bool:
        """
        Check if this engine is currently available and healthy.

        Returns:
            True if the engine can accept requests, False otherwise.

        Example:
            if engine.is_available():
                response = engine.generate(prompt, context)
        """
        ...

    @abstractmethod
    def get_name(self) -> str:
        """
        Return the name identifier for this engine.

        Returns:
            A string name like "openai", "claude", "gemini", or "local".

        Example:
            name = engine.get_name()  # "claude"
        """
        ...

    def format_messages(self, prompt: str, context: list[dict]) -> list[dict]:
        """
        Convert context into standard OpenAI message format and append user prompt.

        Creates a message list suitable for LLM API calls in the format:
        [{"role": "system"|"user"|"assistant", "content": "..."}]

        Args:
            prompt: The user's message or instruction.
            context: A list of prior message dicts (role, content).

        Returns:
            A list of message dicts in OpenAI format, with the user prompt
            appended as the final message.

        Example:
            messages = engine.format_messages(
                "What is OAuth?",
                [{"role": "system", "content": "You are helpful."}]
            )
            # [{"role": "system", "content": "You are helpful."},
            #  {"role": "user", "content": "What is OAuth?"}]
        """
        messages = []
        for msg in context:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            if role in ("system", "user", "assistant") and content:
                messages.append({"role": role, "content": content})
        messages.append({"role": "user", "content": prompt})
        return messages
