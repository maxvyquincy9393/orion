"""
process.py

Daemon process that runs continuously in the background.
This is the heartbeat of Orion - it never sleeps.
Monitors triggers, manages threads, and initiates proactive outreach.
Part of Orion — Persistent AI Companion System.
"""

import logging
import threading
import time
from datetime import datetime, timezone
from typing import Any, Optional

import config

_log = logging.getLogger("orion.daemon")
_log_file = config.LOGS_DIR / "daemon.log"
_handler = logging.FileHandler(_log_file)
_handler.setFormatter(logging.Formatter("%(asctime)s | %(levelname)-8s | %(message)s"))
_log.addHandler(_handler)
_log.setLevel(getattr(logging, config.LOG_LEVEL, logging.INFO))

_daemon_instance: Optional["OrionDaemon"] = None


class OrionDaemon:
    """
    Background daemon for Orion proactive behavior.

    Runs every 60 seconds in a separate thread:
    - Build context dict (time, pending threads, last message)
    - Call trigger_engine.get_fired_triggers()
    - For each fired trigger: check permission, open thread, send message
    - Check pending threads for follow-ups

    Example:
        daemon = OrionDaemon()
        daemon.start()
        # ... later ...
        daemon.stop()
    """

    def __init__(self, interval_seconds: int = 60):
        """
        Initialize the daemon.

        Args:
            interval_seconds: Seconds between daemon cycles. Defaults to 60.
        """
        self.interval_seconds = interval_seconds
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._start_time: Optional[datetime] = None
        self._cycle_count = 0
        self._last_trigger: Optional[str] = None
        self._trigger_engine = None
        self._quiet_hours = self._load_quiet_hours()

    def _load_quiet_hours(self) -> dict:
        """Load quiet hours config."""
        try:
            from permissions.config_loader import load_config, get

            load_config(config.PERMISSIONS_YAML_PATH)
            proactive = get("proactive")
            if proactive:
                return proactive.get("quiet_hours", {"start": "22:00", "end": "08:00"})
        except Exception:
            pass
        return {"start": "22:00", "end": "08:00"}

    def _is_quiet_hours(self) -> bool:
        """Check if current time is within quiet hours."""
        now = datetime.now()
        current_time = now.strftime("%H:%M")

        start = self._quiet_hours.get("start", "22:00")
        end = self._quiet_hours.get("end", "08:00")

        if start <= end:
            return start <= current_time < end
        else:
            return current_time >= start or current_time < end

    def start(self) -> None:
        """
        Start the daemon loop in a separate thread.

        Never blocks main thread.

        Example:
            daemon.start()
        """
        if self._running:
            _log.warning("DAEMON | Already running")
            return

        self._running = True
        self._start_time = datetime.now(timezone.utc)
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

        _log.info(
            "DAEMON STARTED | interval=%ds | quiet_hours=%s",
            self.interval_seconds,
            self._quiet_hours,
        )

    def stop(self) -> None:
        """
        Gracefully stop the daemon loop.

        Example:
            daemon.stop()
        """
        if not self._running:
            return

        self._running = False

        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=5)

        _log.info("DAEMON STOPPED | cycles=%d", self._cycle_count)

    def _loop(self) -> None:
        """Main daemon loop - runs every interval_seconds."""
        while self._running:
            try:
                self.run_cycle()
            except Exception as exc:
                _log.error("DAEMON CYCLE ERROR | %s", exc)

            time.sleep(self.interval_seconds)

    def run_cycle(self) -> None:
        """
        Execute a single daemon cycle.

        Steps:
        1. Build context dict
        2. Get fired triggers
        3. For each trigger: check permission, send message
        4. Check pending threads for follow-ups

        Example:
            daemon.run_cycle()
        """
        self._cycle_count += 1
        cycle_start = datetime.now(timezone.utc)

        _log.debug("DAEMON CYCLE | cycle=%d", self._cycle_count)

        if self._is_quiet_hours():
            _log.debug("DAEMON | Quiet hours - skipping proactive messages")
            self._check_follow_ups()
            return

        context = self._build_context()

        if self._trigger_engine is None:
            from background.triggers import TriggerEngine

            self._trigger_engine = TriggerEngine()

        fired_triggers = self._trigger_engine.get_fired_triggers(context)

        for trigger in fired_triggers:
            self._process_trigger(trigger, context)

        self._check_follow_ups()

        cycle_duration = (datetime.now(timezone.utc) - cycle_start).total_seconds()
        _log.info(
            "DAEMON CYCLE COMPLETE | cycle=%d | triggers=%d | duration=%.2fs",
            self._cycle_count,
            len(fired_triggers),
            cycle_duration,
        )

    def _build_context(self) -> dict[str, Any]:
        """
        Build context dict for trigger evaluation.

        Returns:
            Context with current_time, day, last_message_time, pending_threads.
        """
        now = datetime.now(timezone.utc)
        day_names = [
            "monday",
            "tuesday",
            "wednesday",
            "thursday",
            "friday",
            "saturday",
            "sunday",
        ]

        context: dict[str, Any] = {
            "current_time": now,
            "day": day_names[now.weekday()],
            "hour": now.hour,
            "minute": now.minute,
            "last_message_time": None,
            "pending_threads": [],
        }

        try:
            import core.memory as memory

            user_id = config.DEFAULT_USER_ID
            history = memory.get_history(user_id, limit=1)
            if history:
                last_msg = history[-1]
                if last_msg.get("timestamp"):
                    context["last_message_time"] = datetime.fromisoformat(
                        last_msg["timestamp"]
                    )
        except Exception:
            pass

        try:
            from background.thread_manager import get_pending_threads

            context["pending_threads"] = get_pending_threads(config.DEFAULT_USER_ID)
        except Exception:
            pass

        return context

    def _process_trigger(self, trigger, context: dict) -> None:
        """
        Process a fired trigger.

        Args:
            trigger: The Trigger that fired.
            context: Context dict.
        """
        try:
            from permissions.permission_types import PermissionAction
            from permissions import sandbox
            from background.triggers import TriggerEngine

            result = sandbox.check(
                PermissionAction.PROACTIVE_MESSAGE.value,
                {"trigger_id": trigger.id, "trigger_type": trigger.type.value},
            )

            if not result.allowed:
                _log.info(
                    "TRIGGER BLOCKED | id=%s | reason=%s", trigger.id, result.reason
                )
                return

            from background.thread_manager import open_thread
            from delivery.messenger import send

            thread_id = open_thread(
                config.DEFAULT_USER_ID,
                f"Trigger: {trigger.id}",
            )

            engine = TriggerEngine()
            message = engine.build_message(trigger, context)

            chat_id = getattr(config, "TELEGRAM_CHAT_ID", config.DEFAULT_USER_ID)
            success = send(chat_id, message)

            if success:
                engine.mark_fired(trigger.id)
                self._last_trigger = trigger.id
                _log.info("TRIGGER SENT | id=%s | thread=%s", trigger.id, thread_id)
            else:
                _log.error("TRIGGER SEND FAILED | id=%s", trigger.id)

        except Exception as exc:
            _log.error("TRIGGER PROCESS ERROR | id=%s | error=%s", trigger.id, exc)

    def _check_follow_ups(self) -> None:
        """Check pending threads for follow-ups."""
        try:
            from background.thread_manager import (
                get_pending_threads,
                should_follow_up,
                set_thread_waiting,
            )
            from delivery.messenger import send

            pending = get_pending_threads(config.DEFAULT_USER_ID)

            for thread in pending:
                thread_id = thread.get("thread_id")
                state = thread.get("state")

                if state == "waiting":
                    if should_follow_up(thread_id):
                        message = f"Following up on: {thread.get('trigger', 'our conversation')}. Still need help?"
                        chat_id = getattr(
                            config, "TELEGRAM_CHAT_ID", config.DEFAULT_USER_ID
                        )
                        send(chat_id, message)
                        _log.info("FOLLOW-UP SENT | thread_id=%s", thread_id)

        except Exception as exc:
            _log.error("FOLLOW-UP CHECK ERROR | %s", exc)

    def get_status(self) -> dict[str, Any]:
        """
        Get daemon status.

        Returns:
            Status dict with running, uptime, cycle_count, etc.
        """
        uptime = 0
        if self._start_time:
            uptime = (datetime.now(timezone.utc) - self._start_time).total_seconds()

        return {
            "running": self._running,
            "uptime_seconds": int(uptime),
            "cycle_count": self._cycle_count,
            "interval_seconds": self.interval_seconds,
            "last_trigger": self._last_trigger,
            "quiet_hours": self._quiet_hours,
        }


def start_daemon() -> OrionDaemon:
    """
    Start the Orion background daemon process.

    Returns:
        The OrionDaemon instance.

    Example:
        daemon = start_daemon()
    """
    global _daemon_instance

    if _daemon_instance is not None and _daemon_instance._running:
        return _daemon_instance

    _daemon_instance = OrionDaemon()
    _daemon_instance.start()
    return _daemon_instance


def stop_daemon() -> None:
    """
    Gracefully stop the Orion background daemon.

    Example:
        stop_daemon()
    """
    global _daemon_instance

    if _daemon_instance is not None:
        _daemon_instance.stop()
        _daemon_instance = None


def health_check() -> dict:
    """
    Check the health status of the background daemon.

    Returns:
        A dict with status info: running, uptime_seconds, cycle_count, etc.

    Example:
        status = health_check()
    """
    global _daemon_instance

    if _daemon_instance is None:
        return {"status": "stopped", "uptime_seconds": 0, "active_threads": 0}

    status = _daemon_instance.get_status()
    status["status"] = "running" if status["running"] else "stopped"

    try:
        from background.thread_manager import get_pending_threads

        pending = get_pending_threads(config.DEFAULT_USER_ID)
        status["active_threads"] = len(pending)
    except Exception:
        status["active_threads"] = 0

    return status


def get_daemon() -> Optional[OrionDaemon]:
    """
    Get the current daemon instance.

    Returns:
        OrionDaemon instance or None if not started.
    """
    return _daemon_instance
