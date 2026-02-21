"""
thread_manager.py

Tracks conversation thread state across sessions.
Manages thread lifecycle: open -> waiting -> resolved.
Determines when follow-ups are needed for open threads.
Part of Orion — Persistent AI Companion System.
"""

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import select

import config
from database.models import Thread, ThreadState, User, get_session

_log = logging.getLogger("orion.threads")
_log_file = config.LOGS_DIR / "threads.log"
_handler = logging.FileHandler(_log_file)
_handler.setFormatter(logging.Formatter("%(asctime)s | %(levelname)-8s | %(message)s"))
_log.addHandler(_handler)
_log.setLevel(getattr(logging, config.LOG_LEVEL, logging.INFO))


def open_thread(user_id: str, trigger: str) -> str:
    """
    Open a new conversation thread for a user.

    Creates a Thread record in DB with state OPEN.

    Args:
        user_id: The unique identifier of the user.
        trigger: The reason/trigger that initiated this thread.

    Returns:
        The unique thread_id string for the new thread.

    Example:
        thread_id = open_thread("owner", "Proactive check-in about OAuth setup")
    """
    db = get_session()
    try:
        user = _get_or_create_user(db, user_id)

        thread = Thread(
            user_id=user.id,
            trigger=trigger,
            state=ThreadState.OPEN,
        )
        db.add(thread)
        db.commit()
        db.refresh(thread)

        thread_id = str(thread.id)
        _log.info(
            "THREAD OPENED | thread_id=%s | user=%s | trigger=%s",
            thread_id,
            user_id,
            trigger[:50],
        )
        return thread_id

    except Exception as exc:
        db.rollback()
        _log.error("THREAD OPEN FAILED | user=%s | error=%s", user_id, exc)
        raise
    finally:
        db.close()


def update_state(thread_id: str, state: str) -> None:
    """
    Update the state of an existing thread.

    Logs state transition for audit trail.

    Args:
        thread_id: The unique identifier of the thread.
        state: The new state - "open", "waiting", or "resolved".

    Returns:
        None

    Example:
        update_state("thread_abc", "resolved")
    """
    state_map = {
        "open": ThreadState.OPEN,
        "waiting": ThreadState.WAITING,
        "resolved": ThreadState.RESOLVED,
    }

    if state.lower() not in state_map:
        _log.error("THREAD UPDATE FAILED | invalid state: %s", state)
        raise ValueError(
            f"Invalid thread state: {state}. Must be open, waiting, or resolved."
        )

    new_state = state_map[state.lower()]

    db = get_session()
    try:
        thread_uuid = uuid.UUID(thread_id)
        thread = db.get(Thread, thread_uuid)

        if not thread:
            _log.error("THREAD UPDATE FAILED | thread not found: %s", thread_id)
            raise ValueError(f"Thread not found: {thread_id}")

        old_state = thread.state.value if thread.state else "unknown"
        thread.state = new_state
        db.commit()

        _log.info(
            "THREAD STATE CHANGE | thread_id=%s | %s -> %s",
            thread_id,
            old_state,
            state.lower(),
        )

    except ValueError:
        raise
    except Exception as exc:
        db.rollback()
        _log.error("THREAD UPDATE FAILED | thread_id=%s | error=%s", thread_id, exc)
        raise
    finally:
        db.close()


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
    db = get_session()
    try:
        user = _get_user(db, user_id)
        if not user:
            _log.info("GET PENDING | user not found: %s", user_id)
            return []

        stmt = (
            select(Thread)
            .where(Thread.user_id == user.id)
            .where(Thread.state != ThreadState.RESOLVED)
            .order_by(Thread.created_at.desc())
        )

        threads = list(db.scalars(stmt).all())

        result = [
            {
                "thread_id": str(t.id),
                "state": t.state.value,
                "trigger": t.trigger,
                "created_at": t.created_at.isoformat() if t.created_at else None,
                "updated_at": t.updated_at.isoformat() if t.updated_at else None,
                "context": t.context or {},
            }
            for t in threads
        ]

        _log.info("GET PENDING | user=%s | count=%d", user_id, len(result))
        return result

    except Exception as exc:
        _log.error("GET PENDING FAILED | user=%s | error=%s", user_id, exc)
        return []
    finally:
        db.close()


def should_follow_up(thread_id: str) -> bool:
    """
    Determine if a thread needs a follow-up message.

    Returns True if thread is in WAITING state and no reply after 1 hour.

    Args:
        thread_id: The unique identifier of the thread.

    Returns:
        True if a follow-up is warranted, False otherwise.

    Example:
        if should_follow_up("thread_abc"):
            send_follow_up(thread_id)
    """
    db = get_session()
    try:
        thread_uuid = uuid.UUID(thread_id)
        thread = db.get(Thread, thread_uuid)

        if not thread:
            _log.debug("SHOULD FOLLOW UP | thread not found: %s", thread_id)
            return False

        if thread.state != ThreadState.WAITING:
            return False

        if not thread.updated_at:
            return False

        now = datetime.now(timezone.utc)
        hours_since_update = (now - thread.updated_at).total_seconds() / 3600

        if hours_since_update >= 1:
            _log.info(
                "SHOULD FOLLOW UP | thread_id=%s | hours_since_update=%.1f",
                thread_id,
                hours_since_update,
            )
            return True

        return False

    except ValueError:
        return False
    except Exception as exc:
        _log.error("SHOULD FOLLOW UP FAILED | thread_id=%s | error=%s", thread_id, exc)
        return False
    finally:
        db.close()


def get_thread(thread_id: str) -> Optional[dict]:
    """
    Get a single thread by ID.

    Args:
        thread_id: The thread ID.

    Returns:
        Thread dict or None if not found.

    Example:
        thread = get_thread("abc-123")
    """
    db = get_session()
    try:
        thread_uuid = uuid.UUID(thread_id)
        thread = db.get(Thread, thread_uuid)

        if not thread:
            return None

        return {
            "thread_id": str(thread.id),
            "state": thread.state.value,
            "trigger": thread.trigger,
            "created_at": thread.created_at.isoformat() if thread.created_at else None,
            "updated_at": thread.updated_at.isoformat() if thread.updated_at else None,
            "context": thread.context or {},
        }

    except (ValueError, Exception):
        return None
    finally:
        db.close()


def resolve_thread(thread_id: str) -> bool:
    """
    Mark a thread as resolved.

    Args:
        thread_id: The thread ID to resolve.

    Returns:
        True on success, False if thread not found.

    Example:
        resolve_thread("abc-123")
    """
    try:
        update_state(thread_id, "resolved")
        return True
    except Exception:
        return False


def set_thread_waiting(thread_id: str) -> bool:
    """
    Mark a thread as waiting for user response.

    Args:
        thread_id: The thread ID.

    Returns:
        True on success, False if thread not found.

    Example:
        set_thread_waiting("abc-123")
    """
    try:
        update_state(thread_id, "waiting")
        return True
    except Exception:
        return False


def update_thread_context(thread_id: str, context: dict) -> bool:
    """
    Update the context dict of a thread.

    Args:
        thread_id: The thread ID.
        context: Context dict to merge into existing context.

    Returns:
        True on success, False if thread not found.

    Example:
        update_thread_context("abc-123", {"last_topic": "OAuth"})
    """
    db = get_session()
    try:
        thread_uuid = uuid.UUID(thread_id)
        thread = db.get(Thread, thread_uuid)

        if not thread:
            return False

        existing_context = thread.context or {}
        existing_context.update(context)
        thread.context = existing_context
        db.commit()

        _log.debug("THREAD CONTEXT UPDATED | thread_id=%s", thread_id)
        return True

    except Exception as exc:
        db.rollback()
        _log.error(
            "THREAD CONTEXT UPDATE FAILED | thread_id=%s | error=%s", thread_id, exc
        )
        return False
    finally:
        db.close()


def _get_user(db, user_id: str) -> Optional[User]:
    """Get user by ID or name."""
    try:
        uid = uuid.UUID(user_id)
        return db.get(User, uid)
    except (ValueError, AttributeError):
        pass

    stmt = select(User).where(User.name == user_id).limit(1)
    return db.scalars(stmt).first()


def _get_or_create_user(db, user_id: str) -> User:
    """Get existing user or create new one."""
    user = _get_user(db, user_id)
    if user:
        return user

    try:
        pk = uuid.UUID(user_id)
    except (ValueError, AttributeError):
        pk = uuid.uuid4()

    user = User(id=pk, name=user_id)
    db.add(user)
    db.flush()
    _log.info("AUTO-CREATED USER | user_id=%s", user_id)
    return user
