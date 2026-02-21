"""
triggers.py

Trigger detection system for Orion proactive behavior.
Detects when Orion should proactively reach out to the user based on
time patterns, inactivity, schedules, and keywords.
Part of Orion — Persistent AI Companion System.
"""

import enum
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

import yaml

import config

_log = logging.getLogger("orion.triggers")
_log_file = config.LOGS_DIR / "triggers.log"
_handler = logging.FileHandler(_log_file)
_handler.setFormatter(logging.Formatter("%(asctime)s | %(levelname)-8s | %(message)s"))
_log.addHandler(_handler)
_log.setLevel(getattr(logging, config.LOG_LEVEL, logging.INFO))

TRIGGERS_FILE = config.PROJECT_ROOT / "background" / "triggers.yaml"


class TriggerType(str, enum.Enum):
    """Types of triggers for proactive outreach."""

    TIME_BASED = "time_based"
    SCHEDULE = "schedule"
    PATTERN = "pattern"
    INACTIVITY = "inactivity"
    KEYWORD = "keyword"


@dataclass
class Trigger:
    """
    A trigger definition for proactive outreach.

    Attributes:
        id: Unique trigger identifier.
        type: The TriggerType enum value.
        condition: Dict defining when trigger fires.
        message_template: Template string for the message.
        last_fired: When this trigger last fired.
        enabled: Whether trigger is active.
    """

    id: str
    type: TriggerType
    condition: dict[str, Any]
    message_template: str
    last_fired: Optional[datetime] = None
    enabled: bool = True

    def to_dict(self) -> dict[str, Any]:
        """Convert trigger to dictionary for YAML serialization."""
        return {
            "id": self.id,
            "type": self.type.value,
            "condition": self.condition,
            "message_template": self.message_template,
            "last_fired": self.last_fired.isoformat() if self.last_fired else None,
            "enabled": self.enabled,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Trigger":
        """Create Trigger from dictionary."""
        return cls(
            id=data.get("id", str(uuid.uuid4())),
            type=TriggerType(data.get("type", "time_based")),
            condition=data.get("condition", {}),
            message_template=data.get("message_template", ""),
            last_fired=datetime.fromisoformat(data["last_fired"])
            if data.get("last_fired")
            else None,
            enabled=data.get("enabled", True),
        )


DEFAULT_TRIGGERS = [
    {
        "id": "morning_checkin",
        "type": "time_based",
        "condition": {
            "hour": 8,
            "minute": 0,
            "days": ["mon", "tue", "wed", "thu", "fri"],
        },
        "message_template": "Good morning! It's {time}. How can I help you today?",
        "enabled": True,
    },
    {
        "id": "inactivity_reminder",
        "type": "inactivity",
        "condition": {"hours": 4},
        "message_template": "It's been {hours} hours since we last talked. Anything on your mind?",
        "enabled": True,
    },
    {
        "id": "end_of_day_summary",
        "type": "time_based",
        "condition": {
            "hour": 18,
            "minute": 0,
            "days": ["mon", "tue", "wed", "thu", "fri"],
        },
        "message_template": "End of day check: {date}. Any tasks to wrap up before tomorrow?",
        "enabled": True,
    },
]


class TriggerEngine:
    """
    Engine for evaluating and managing proactive triggers.

    Loads triggers from YAML, evaluates conditions against context,
    and builds messages from templates.

    Example:
        engine = TriggerEngine()
        fired = engine.get_fired_triggers(context)
        for trigger in fired:
            message = engine.build_message(trigger, context)
    """

    def __init__(self, triggers_file: Optional[Path] = None):
        """
        Initialize the trigger engine.

        Args:
            triggers_file: Path to triggers.yaml. Defaults to background/triggers.yaml.
        """
        self.triggers_file = triggers_file or TRIGGERS_FILE
        self._triggers: list[Trigger] = []
        self._load_triggers()

    def _load_triggers(self) -> None:
        """Load triggers from YAML file, creating default if not exists."""
        if not self.triggers_file.exists():
            _log.info("Creating default triggers.yaml at %s", self.triggers_file)
            self._create_default_triggers()
            return

        try:
            with open(self.triggers_file, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}
            triggers_data = data.get("triggers", [])
            self._triggers = [Trigger.from_dict(t) for t in triggers_data]
            _log.info(
                "Loaded %d triggers from %s", len(self._triggers), self.triggers_file
            )
        except Exception as exc:
            _log.error("Failed to load triggers: %s", exc)
            self._triggers = []

    def _create_default_triggers(self) -> None:
        """Create default triggers.yaml file."""
        self.triggers_file.parent.mkdir(parents=True, exist_ok=True)

        data = {"triggers": DEFAULT_TRIGGERS}
        with open(self.triggers_file, "w", encoding="utf-8") as f:
            yaml.dump(data, f, default_flow_style=False, sort_keys=False)

        self._triggers = [Trigger.from_dict(t) for t in DEFAULT_TRIGGERS]

    def load_triggers(self) -> list[Trigger]:
        """
        Load triggers from triggers.yaml.

        Returns:
            List of Trigger objects.

        Example:
            triggers = engine.load_triggers()
        """
        self._load_triggers()
        return self._triggers

    def evaluate(self, trigger: Trigger, context: dict[str, Any]) -> bool:
        """
        Evaluate whether a trigger should fire based on context.

        Args:
            trigger: The Trigger to evaluate.
            context: Context dict with current time, last message time, etc.

        Returns:
            True if trigger condition is met.

        Example:
            should_fire = engine.evaluate(trigger, {"current_time": datetime.now()})
        """
        if not trigger.enabled:
            return False

        now = context.get("current_time", datetime.now(timezone.utc))
        condition = trigger.condition

        if trigger.type == TriggerType.TIME_BASED:
            return self._evaluate_time_based(condition, now, trigger.last_fired)

        if trigger.type == TriggerType.INACTIVITY:
            return self._evaluate_inactivity(condition, context, trigger.last_fired)

        if trigger.type == TriggerType.SCHEDULE:
            return self._evaluate_schedule(condition, now, trigger.last_fired)

        if trigger.type == TriggerType.KEYWORD:
            return self._evaluate_keyword(condition, context)

        if trigger.type == TriggerType.PATTERN:
            return self._evaluate_pattern(condition, context, trigger.last_fired)

        return False

    def _evaluate_time_based(
        self, condition: dict, now: datetime, last_fired: Optional[datetime]
    ) -> bool:
        """Evaluate time-based trigger."""
        target_hour = condition.get("hour", 0)
        target_minute = condition.get("minute", 0)
        allowed_days = condition.get("days", [])

        day_names = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
        current_day = day_names[now.weekday()]

        if allowed_days and current_day not in allowed_days:
            return False

        if now.hour != target_hour or now.minute != target_minute:
            return False

        if last_fired:
            hours_since = (now - last_fired).total_seconds() / 3600
            if hours_since < 23:
                return False

        return True

    def _evaluate_inactivity(
        self, condition: dict, context: dict, last_fired: Optional[datetime]
    ) -> bool:
        """Evaluate inactivity trigger."""
        threshold_hours = condition.get("hours", 4)
        last_message_time = context.get("last_message_time")

        if not last_message_time:
            return False

        if isinstance(last_message_time, str):
            last_message_time = datetime.fromisoformat(
                last_message_time.replace("Z", "+00:00")
            )

        now = context.get("current_time", datetime.now(timezone.utc))
        hours_inactive = (now - last_message_time).total_seconds() / 3600

        if hours_inactive < threshold_hours:
            return False

        if last_fired:
            hours_since_fired = (now - last_fired).total_seconds() / 3600
            if hours_since_fired < threshold_hours:
                return False

        return True

    def _evaluate_schedule(
        self, condition: dict, now: datetime, last_fired: Optional[datetime]
    ) -> bool:
        """Evaluate schedule-based trigger (specific dates/times)."""
        schedule_times = condition.get("times", [])
        for schedule in schedule_times:
            schedule_time = datetime.fromisoformat(schedule)
            if now.hour == schedule_time.hour and now.minute == schedule_time.minute:
                if last_fired and (now - last_fired).total_seconds() < 3600:
                    continue
                return True
        return False

    def _evaluate_keyword(self, condition: dict, context: dict) -> bool:
        """Evaluate keyword trigger."""
        keywords = condition.get("keywords", [])
        recent_messages = context.get("recent_messages", [])

        for msg in recent_messages:
            text = msg.get("content", "").lower()
            for keyword in keywords:
                if keyword.lower() in text:
                    return True
        return False

    def _evaluate_pattern(
        self, condition: dict, context: dict, last_fired: Optional[datetime]
    ) -> bool:
        """Evaluate pattern-based trigger."""
        pattern_type = condition.get("pattern_type")
        now = context.get("current_time", datetime.now(timezone.utc))

        if pattern_type == "daily":
            target_hour = condition.get("hour", 12)
            if now.hour == target_hour and now.minute == 0:
                if last_fired and (now - last_fired).total_seconds() < 86400:
                    return False
                return True

        if pattern_type == "weekly":
            target_day = condition.get("day", 0)
            target_hour = condition.get("hour", 12)
            if (
                now.weekday() == target_day
                and now.hour == target_hour
                and now.minute == 0
            ):
                if last_fired and (now - last_fired).total_seconds() < 604800:
                    return False
                return True

        return False

    def get_fired_triggers(self, context: dict[str, Any]) -> list[Trigger]:
        """
        Get all triggers that should fire now.

        Args:
            context: Context dict for evaluation.

        Returns:
            List of Trigger objects that should fire.

        Example:
            fired = engine.get_fired_triggers({"current_time": datetime.now()})
        """
        fired = []
        for trigger in self._triggers:
            try:
                if self.evaluate(trigger, context):
                    _log.info(
                        "TRIGGER FIRED | id=%s | type=%s",
                        trigger.id,
                        trigger.type.value,
                    )
                    fired.append(trigger)
            except Exception as exc:
                _log.error("TRIGGER EVAL ERROR | id=%s | error=%s", trigger.id, exc)

        return fired

    def build_message(self, trigger: Trigger, context: dict[str, Any]) -> str:
        """
        Build a message from trigger template and context.

        Fills message_template with context variables.

        Args:
            trigger: The Trigger that fired.
            context: Context dict for variable substitution.

        Returns:
            The formatted message string.

        Example:
            message = engine.build_message(trigger, {"time": "8:00 AM"})
        """
        now = context.get("current_time", datetime.now(timezone.utc))
        last_message_time = context.get("last_message_time")

        template_vars = {
            "time": now.strftime("%I:%M %p"),
            "date": now.strftime("%Y-%m-%d"),
            "day": now.strftime("%A"),
            "hours": trigger.condition.get("hours", 4),
        }

        if last_message_time:
            if isinstance(last_message_time, str):
                last_message_time = datetime.fromisoformat(
                    last_message_time.replace("Z", "+00:00")
                )
            hours_since = (now - last_message_time).total_seconds() / 3600
            template_vars["hours"] = int(hours_since)

        message = trigger.message_template
        for key, value in template_vars.items():
            placeholder = "{" + key + "}"
            message = message.replace(placeholder, str(value))

        return message

    def mark_fired(self, trigger_id: str) -> None:
        """
        Mark a trigger as fired, updating last_fired timestamp.

        Also logs to TriggerLog model if database is available.

        Args:
            trigger_id: The ID of the trigger that fired.

        Example:
            engine.mark_fired("morning_checkin")
        """
        now = datetime.now(timezone.utc)

        for trigger in self._triggers:
            if trigger.id == trigger_id:
                trigger.last_fired = now
                break

        self._save_triggers()

        try:
            from database.models import TriggerLog, get_session, User
            from sqlalchemy import select

            db = get_session()
            try:
                user = db.scalars(select(User).limit(1)).first()
                if user:
                    log_entry = TriggerLog(
                        user_id=user.id,
                        trigger_type=trigger_id,
                        reason=f"Trigger {trigger_id} fired at {now.isoformat()}",
                        urgency="medium",
                        acted_on=True,
                    )
                    db.add(log_entry)
                    db.commit()
                    _log.info("TRIGGER LOGGED | id=%s | logged to database", trigger_id)
            finally:
                db.close()
        except Exception as exc:
            _log.debug("Could not log trigger to database: %s", exc)

        _log.info(
            "TRIGGER MARKED FIRED | id=%s | timestamp=%s", trigger_id, now.isoformat()
        )

    def _save_triggers(self) -> None:
        """Save current triggers back to YAML file."""
        data = {"triggers": [t.to_dict() for t in self._triggers]}
        try:
            with open(self.triggers_file, "w", encoding="utf-8") as f:
                yaml.dump(data, f, default_flow_style=False, sort_keys=False)
        except Exception as exc:
            _log.error("Failed to save triggers: %s", exc)

    def add_trigger(self, trigger: Trigger) -> None:
        """
        Add a new trigger to the engine.

        Args:
            trigger: The Trigger to add.
        """
        self._triggers.append(trigger)
        self._save_triggers()
        _log.info("TRIGGER ADDED | id=%s", trigger.id)

    def remove_trigger(self, trigger_id: str) -> bool:
        """
        Remove a trigger by ID.

        Args:
            trigger_id: The ID of the trigger to remove.

        Returns:
            True if trigger was removed, False if not found.
        """
        for i, trigger in enumerate(self._triggers):
            if trigger.id == trigger_id:
                del self._triggers[i]
                self._save_triggers()
                _log.info("TRIGGER REMOVED | id=%s", trigger_id)
                return True
        return False


def check_triggers(user_id: str) -> list[dict]:
    """
    Evaluate all trigger conditions for a user.

    Args:
        user_id: The unique identifier of the user.

    Returns:
        A list of trigger dicts, each with type, reason, priority, and payload.

    Example:
        triggers = check_triggers("owner")
    """
    engine = TriggerEngine()
    context = _build_context(user_id)
    fired = engine.get_fired_triggers(context)

    results = []
    for trigger in fired:
        message = engine.build_message(trigger, context)
        results.append(
            {
                "id": trigger.id,
                "type": trigger.type.value,
                "message": message,
                "priority": "medium",
            }
        )

    return results


def register_trigger(trigger_type: str, condition: dict) -> None:
    """
    Register a new trigger condition that the system should monitor.

    Args:
        trigger_type: The type of trigger.
        condition: A dict defining the trigger condition and parameters.

    Example:
        register_trigger("time_based", {"hour": 9, "message": "Morning check-in"})
    """
    engine = TriggerEngine()
    trigger = Trigger(
        id=str(uuid.uuid4()),
        type=TriggerType(trigger_type),
        condition=condition,
        message_template=condition.get("message", "Orion check-in"),
        enabled=True,
    )
    engine.add_trigger(trigger)


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
    trigger_type = trigger.get("type", "")

    if trigger_type in ("inactivity", "time_based"):
        return "low"

    if trigger_type in ("schedule", "pattern"):
        return "medium"

    if trigger_type == "keyword":
        return "high"

    return "medium"


def _build_context(user_id: str) -> dict[str, Any]:
    """
    Build context dict for trigger evaluation.

    Args:
        user_id: The user ID.

    Returns:
        Context dict with current time, last message time, etc.
    """
    context: dict[str, Any] = {
        "current_time": datetime.now(timezone.utc),
        "last_message_time": None,
        "recent_messages": [],
    }

    try:
        import core.memory as memory

        history = memory.get_history(user_id, limit=5)
        if history:
            context["recent_messages"] = history
            last_msg = history[-1] if history else None
            if last_msg and last_msg.get("timestamp"):
                context["last_message_time"] = datetime.fromisoformat(
                    last_msg["timestamp"]
                )
    except Exception:
        pass

    return context
