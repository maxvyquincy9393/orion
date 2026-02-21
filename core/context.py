"""
context.py

Builds the context window before each LLM call.
Combines recent chat history, relevant RAG results, and system prompts
into a structured context that is passed to the engine.
Part of Orion — Persistent AI Companion System.
"""

import logging
from typing import Any

import config
import core.memory as memory
import core.rag as rag

_log = logging.getLogger("orion.context")
_handler = logging.FileHandler(config.LOGS_DIR / "context.log")
_handler.setFormatter(logging.Formatter("%(asctime)s  %(levelname)-8s  %(message)s"))
_log.addHandler(_handler)
_log.setLevel(getattr(logging, config.LOG_LEVEL, logging.INFO))

_SYSTEM_PROMPT = """You are Orion, a Persistent AI Companion System.

WHO YOU ARE:
- An AI that lives in the background, always aware and ready to help
- You remember ALL conversations permanently across sessions
- You can proactively reach out to the user when needed
- You have system access within a fully configurable permission sandbox
- Every capability you have is toggleable by the user

YOUR CAPABILITIES (when enabled by user permissions):
- Browse the web autonomously and extract information
- Read, write, and manage files on the user's system
- Execute terminal commands with user confirmation
- Control applications and system settings
- Access calendar and schedule events
- See through camera or screen capture (when enabled)
- Process voice input and respond with voice

YOUR PERSONALITY:
- Warm, helpful, and genuinely interested in the user's wellbeing
- Proactive but not pushy — you suggest, don't demand
- Honest about your capabilities and limitations
- You remember context from previous conversations naturally
- You follow up on past topics when relevant

BEHAVIOR GUIDELINES:
- Never claim capabilities you don't have or aren't permitted
- Always respect the permission sandbox — it keeps both you and the user safe
- If you need to perform a restricted action, ask for confirmation first
- Reference past conversations naturally: "Last time we discussed..."
- Be concise but thorough — don't waste tokens on filler
- When uncertain, ask clarifying questions rather than guessing

You are not a chatbot. You are a persistent AI companion that the user doesn't need to "go to" — you come to them when needed, and you're always there when they reach out."""


def get_system_prompt() -> str:
    """
    Return Orion's system prompt that defines its personality and behavior.

    Returns:
        The system prompt string.

    Example:
        prompt = get_system_prompt()
    """
    return _SYSTEM_PROMPT


def build(user_id: str, prompt: str, task_type: str = "reasoning") -> list[dict]:
    """
    Build the full context window before every LLM call.

    Assembles the final message list by:
    1. Injecting the system prompt (Orion's personality and capabilities)
    2. Fetching RAG context from rag.build_context()
    3. Fetching relevant past context from memory.get_relevant_context()
    4. Fetching last 20 messages from memory.get_history()

    Args:
        user_id: The unique identifier of the user.
        prompt: The current user message/query.
        task_type: The type of task (affects context priorities). Defaults to "reasoning".

    Returns:
        A list of message dicts in OpenAI format ready for any engine.

    Example:
        messages = build("owner", "What did we discuss yesterday?")
    """
    messages: list[dict[str, str]] = []

    messages.append(
        {
            "role": "system",
            "content": get_system_prompt(),
        }
    )

    try:
        rag_context = rag.build_context(prompt, user_id)
        if rag_context:
            context_message = (
                f"RELEVANT CONTEXT FROM KNOWLEDGE BASE:\n"
                f"{rag_context}\n\n"
                f"Use this context to inform your response if relevant."
            )
            messages.append(
                {
                    "role": "system",
                    "content": context_message,
                }
            )
            _log.debug("Injected RAG context: %d chars", len(rag_context))
    except Exception as exc:
        _log.warning("Failed to fetch RAG context: %s", exc)

    try:
        relevant = memory.get_relevant_context(user_id, prompt, top_k=3)
        if relevant:
            context_lines = []
            for r in relevant:
                role = r.get("role", "unknown")
                content = r.get("content", "")
                score = r.get("score", 0.0)
                if content and score > 0.5:
                    context_lines.append(f"[{role}] {content[:200]}")
            if context_lines:
                context_message = (
                    f"RELEVANT PAST CONVERSATION:\n"
                    f"{chr(10).join(context_lines)}\n\n"
                    f"Reference this if relevant to the current query."
                )
                messages.append(
                    {
                        "role": "system",
                        "content": context_message,
                    }
                )
                _log.debug("Injected relevant context: %d items", len(context_lines))
    except Exception as exc:
        _log.warning("Failed to fetch relevant context: %s", exc)

    try:
        history = memory.get_history(user_id, limit=20)
        for msg in history:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            if role in ("user", "assistant") and content:
                messages.append(
                    {
                        "role": role,
                        "content": content,
                    }
                )
        _log.debug("Injected history: %d messages", len(history))
    except Exception as exc:
        _log.warning("Failed to fetch history: %s", exc)

    messages.append(
        {
            "role": "user",
            "content": prompt,
        }
    )

    _log.info(
        "Built context for user=%s: %d messages, task_type=%s",
        user_id,
        len(messages),
        task_type,
    )
    return messages


def truncate_context(messages: list[dict], max_tokens: int) -> list[dict]:
    """
    Truncate a list of messages to fit within a token budget.
    Prioritizes system prompts and recent messages.

    Uses a simple heuristic: ~4 characters per token on average.

    Args:
        messages: The full list of context messages.
        max_tokens: Maximum token budget.

    Returns:
        A truncated list of messages fitting within the token budget.

    Example:
        trimmed = truncate_context(messages, max_tokens=4000)
    """
    if not messages:
        return messages

    CHARS_PER_TOKEN = 4
    max_chars = max_tokens * CHARS_PER_TOKEN

    system_messages = [m for m in messages if m.get("role") == "system"]
    conversation_messages = [m for m in messages if m.get("role") != "system"]

    system_chars = sum(len(m.get("content", "")) for m in system_messages)
    remaining_chars = max_chars - system_chars

    if remaining_chars <= 0:
        _log.warning("System prompts exceed token budget, returning minimal context")
        return system_messages[:1] if system_messages else []

    kept_conversation: list[dict] = []
    total_chars = 0

    for msg in reversed(conversation_messages):
        msg_chars = len(msg.get("content", ""))
        if total_chars + msg_chars <= remaining_chars:
            kept_conversation.insert(0, msg)
            total_chars += msg_chars
        else:
            break

    result = system_messages + kept_conversation
    _log.info(
        "Truncated context: %d → %d messages (%d chars / %d token budget)",
        len(messages),
        len(result),
        system_chars + total_chars,
        max_tokens,
    )
    return result


def build_context(
    user_id: str,
    current_message: str,
    max_tokens: int = 4000,
    include_system_prompt: bool = True,
) -> list[dict]:
    """
    Build a complete context window for an LLM call.

    This is an alias for build() with additional options.

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
    messages = build(user_id, current_message)
    messages = truncate_context(messages, max_tokens)
    return messages
