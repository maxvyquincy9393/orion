"""
triggers.py

Detects when Orion should proactively reach out to the user.
Analyzes context, time patterns, and pending tasks to determine
if AI-initiated contact is warranted.
Part of Orion — Persistent AI Companion System.
"""

from typing import Optional


def check_triggers(user_id: str) -> list[dict]:
    """
    Evaluate all trigger conditions for a user.
    Returns a list of triggered events that warrant proactive outreach.

    Args:
        user_id: The unique identifier of the user.

    Returns:
        A list of trigger dicts, each with type, reason, priority, and payload.

    Example:
        triggers = check_triggers("owner")
        # [{"type": "follow_up", "reason": "Pending task reminder", "priority": "medium"}]
    """
    raise NotImplementedError


def register_trigger(trigger_type: str, condition: dict) -> None:
    """
    Register a new trigger condition that the system should monitor.

    Args:
        trigger_type: The type of trigger (e.g., "time_based", "event_based", "follow_up").
        condition: A dict defining the trigger condition and parameters.

    Returns:
        None

    Example:
        register_trigger("time_based", {"interval_hours": 24, "message": "Daily check-in"})
    """
    raise NotImplementedError


def evaluate_urgency(trigger: dict) -> str:
    """
    Evaluate the urgency level of a triggered event.

    Args:
        trigger: A trigger dict from check_triggers.

    Returns:
        Urgency level string: "low", "medium", "high", or "critical".

    Example:
        urgency = evaluate_urgency(trigger)
    """
    raise NotImplementedError
