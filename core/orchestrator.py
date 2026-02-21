"""
orchestrator.py

Routes tasks to the appropriate LLM engine based on task type.
Determines whether to use GPT-4, Claude, Gemini, or a local model
depending on the nature of the request.
Part of Orion — Persistent AI Companion System.
"""

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from engines.base import BaseEngine


def route(task_type: str) -> "BaseEngine":
    """
    Route a task to the most suitable LLM engine.

    Args:
        task_type: The type of task to route. One of:
            "reasoning" — complex analysis (Claude or GPT-4)
            "code" — code generation and debugging (Copilot or GPT-4)
            "voice" — voice interaction (Whisper + TTS engine)
            "multimodal" — image/audio understanding (Gemini or GPT-4)
            "fast" — quick responses (local Ollama model)

    Returns:
        An instance of the appropriate BaseEngine subclass.

    Example:
        engine = route("reasoning")
        response = engine.generate(prompt, context)
    """
    raise NotImplementedError


def get_available_engines() -> list[str]:
    """
    Return a list of currently available and healthy engine names.

    Returns:
        A list of engine name strings that are ready to accept requests.

    Example:
        engines = get_available_engines()
        # ["openai", "claude", "local"]
    """
    raise NotImplementedError


def get_engine_by_name(name: str) -> "BaseEngine":
    """
    Get a specific engine by its name, bypassing automatic routing.

    Args:
        name: The engine name — "openai", "claude", "gemini", or "local".

    Returns:
        An instance of the specified BaseEngine subclass.

    Example:
        engine = get_engine_by_name("claude")
    """
    raise NotImplementedError
