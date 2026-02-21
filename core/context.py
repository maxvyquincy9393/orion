"""
context.py

Builds the context window before each LLM call.
Combines recent chat history, relevant RAG results, and system prompts
into a structured context that is passed to the engine.
Part of Orion — Persistent AI Companion System.
"""

from typing import Optional


def build_context(
    user_id: str,
    current_message: str,
    max_tokens: int = 4000,
    include_system_prompt: bool = True,
) -> list[dict]:
    """
    Build a complete context window for an LLM call.

    Combines:
    - System prompt (Orion personality and instructions)
    - Relevant past context via RAG
    - Recent conversation history
    - Current user message

    Args:
        user_id: The unique identifier of the user.
        current_message: The user's current message/query.
        max_tokens: Maximum token budget for the context window. Defaults to 4000.
        include_system_prompt: Whether to include the system prompt. Defaults to True.

    Returns:
        A list of message dicts (role, content) ready for the LLM.

    Example:
        context = build_context("owner", "What was the last thing we talked about?")
    """
    raise NotImplementedError


def get_system_prompt() -> str:
    """
    Return Orion's system prompt that defines its personality and behavior.

    Returns:
        The system prompt string.

    Example:
        prompt = get_system_prompt()
    """
    raise NotImplementedError


def truncate_context(messages: list[dict], max_tokens: int) -> list[dict]:
    """
    Truncate a list of messages to fit within a token budget.
    Prioritizes recent messages and high-relevance context.

    Args:
        messages: The full list of context messages.
        max_tokens: Maximum token budget.

    Returns:
        A truncated list of messages fitting within the token budget.

    Example:
        trimmed = truncate_context(messages, max_tokens=4000)
    """
    raise NotImplementedError
