"""
thread_manager.py

Tracks conversation thread state across sessions.
Manages thread lifecycle: open → waiting → resolved.
Determines when follow-ups are needed for open threads.
Part of Orion — Persistent AI Companion System.
"""

from typing import Optional


def open_thread(user_id: str, trigger: str) -> str:
    """
    Open a new conversation thread for a user.

    Args:
        user_id: The unique identifier of the user.
        trigger: The reason/trigger that initiated this thread.

    Returns:
        The unique thread_id string for the new thread.

    Example:
        thread_id = open_thread("owner", "Proactive check-in about OAuth setup")
    """
    raise NotImplementedError


def update_state(thread_id: str, state: str) -> None:
    """
    Update the state of an existing thread.

    Args:
        thread_id: The unique identifier of the thread.
        state: The new state — "open", "waiting", or "resolved".

    Returns:
        None

    Example:
        update_state("thread_abc", "resolved")
    """
    raise NotImplementedError


def get_pending_threads(user_id: str) -> list[dict]:
    """
    Get all threads that are not yet resolved for a user.

    Args:
        user_id: The unique identifier of the user.

    Returns:
        A list of thread dicts with thread_id, state, trigger, created_at, etc.

    Example:
        pending = get_pending_threads("owner")
    """
    raise NotImplementedError


def should_follow_up(thread_id: str) -> bool:
    """
    Determine if a thread needs a follow-up message.
    Based on thread age, state, and last activity.

    Args:
        thread_id: The unique identifier of the thread.

    Returns:
        True if a follow-up is warranted, False otherwise.

    Example:
        if should_follow_up("thread_abc"):
            send_follow_up(thread_id)
    """
    raise NotImplementedError
