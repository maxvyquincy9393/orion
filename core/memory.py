"""
memory.py

Persistent memory system for Orion.
Saves, retrieves, and compresses conversation history across all sessions.
Integrates both the relational database (PostgreSQL via SQLAlchemy) and
the vector store (Supabase pgvector / Chroma) for dual storage:
  • PostgreSQL — authoritative store for messages, sessions, and memories
  • Vector store — semantic index for similarity retrieval (RAG)

Public API (matches SKILL.md core interface exactly)
----------------------------------------------------
    save_message(user_id, role, content, metadata)
    get_history(user_id, limit)
    get_relevant_context(user_id, query, top_k)
    compress_old_sessions(user_id, older_than_days)

Part of Orion — Persistent AI Companion System.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session as SASession

import config
from database.models import (
    Base,
    CompressedMemory,
    Message,
    MessageRole,
    Session,
    User,
    get_engine,
    get_session,
)
from database import vector_store

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

_log = logging.getLogger("orion.memory")
_handler = logging.FileHandler(config.LOGS_DIR / "memory.log")
_handler.setFormatter(logging.Formatter("%(asctime)s  %(levelname)-8s  %(message)s"))
_log.addHandler(_handler)
_log.setLevel(getattr(logging, config.LOG_LEVEL, logging.INFO))


# ===========================================================================
# Internal helpers
# ===========================================================================

def _resolve_user(db: SASession, user_id: str) -> User:
    """
    Return the User row for *user_id*, creating it if it does not exist.

    Args:
        db: Active SQLAlchemy session.
        user_id: Unique user identifier (typically config.DEFAULT_USER_ID).

    Returns:
        The User ORM instance.
    """
    user = db.get(User, user_id)
    if user is None:
        user = User(id=user_id, name=user_id)
        db.add(user)
        db.flush()
        _log.info("Auto-created user record for user_id=%s", user_id)
    return user


def _resolve_user_by_name(db: SASession, user_id: str) -> User | None:
    """
    Look up a user by either UUID primary key or name column.

    Args:
        db: Active SQLAlchemy session.
        user_id: UUID string or plain name.

    Returns:
        The User instance or None.
    """
    # Try UUID lookup first
    try:
        uid = uuid.UUID(user_id)
        user = db.get(User, uid)
        if user is not None:
            return user
    except (ValueError, AttributeError):
        pass

    # Fallback: lookup by name
    stmt = select(User).where(User.name == user_id).limit(1)
    return db.scalars(stmt).first()


def _get_or_create_user(db: SASession, user_id: str) -> User:
    """
    Resolve an existing user or create a new one keyed by *user_id*.

    If *user_id* looks like a valid UUID, it is used as the primary key.
    Otherwise a new UUID is generated and *user_id* is stored as the name.

    Args:
        db: Active SQLAlchemy session.
        user_id: Identifier supplied by callers (often config.DEFAULT_USER_ID).

    Returns:
        The User ORM instance (flushed, so user.id is available).
    """
    existing = _resolve_user_by_name(db, user_id)
    if existing is not None:
        return existing

    # Create new user
    try:
        pk = uuid.UUID(user_id)
    except (ValueError, AttributeError):
        pk = uuid.uuid4()

    user = User(id=pk, name=user_id)
    db.add(user)
    db.flush()
    _log.info("Auto-created user record for user_id=%s (pk=%s)", user_id, pk)
    return user


def _get_active_session(db: SASession, user: User) -> Session:
    """
    Return the most recent open session for *user*, or create a new one.

    A session is considered "open" if ``ended_at`` is NULL.

    Args:
        db: Active SQLAlchemy session.
        user: The User ORM instance.

    Returns:
        A Session ORM instance.
    """
    stmt = (
        select(Session)
        .where(Session.user_id == user.id, Session.ended_at.is_(None))
        .order_by(Session.started_at.desc())
        .limit(1)
    )
    session_row = db.scalars(stmt).first()
    if session_row is not None:
        return session_row

    session_row = Session(user_id=user.id)
    db.add(session_row)
    db.flush()
    _log.info("Created new session %s for user %s", session_row.id, user.id)
    return session_row


def _role_enum(role: str) -> MessageRole:
    """
    Convert a role string to the MessageRole enum.

    Args:
        role: One of "user", "assistant", "system".

    Returns:
        The corresponding MessageRole value.

    Raises:
        ValueError: If role is not recognised.
    """
    try:
        return MessageRole(role.lower())
    except ValueError:
        raise ValueError(
            f"Invalid message role '{role}'. Must be one of: user, assistant, system"
        ) from None


# ===========================================================================
# Public API
# ===========================================================================

def save_message(
    user_id: str,
    role: str,
    content: str,
    metadata: dict[str, Any] | None = None,
) -> None:
    """
    Save a single message to persistent memory.

    Performs two writes:
        1. PostgreSQL — inserts a Message row linked to the active Session.
        2. Vector store — upserts the text + metadata for semantic search.

    Args:
        user_id: The unique identifier of the user.
        role: The message role — "user", "assistant", or "system".
        content: The message content text.
        metadata: Additional metadata (thread_id, engine used, etc.).

    Returns:
        None

    Example:
        save_message("owner", "user", "Hello Orion", {"thread_id": "t1"})
    """
    if metadata is None:
        metadata = {}

    role_enum = _role_enum(role)

    db = get_session()
    try:
        user = _get_or_create_user(db, user_id)
        session_row = _get_active_session(db, user)

        msg = Message(
            user_id=user.id,
            role=role_enum,
            content=content,
            session_id=session_row.id,
            metadata_=metadata,
        )
        db.add(msg)

        # Increment session message count
        session_row.message_count = (session_row.message_count or 0) + 1

        db.commit()
        msg_id = str(msg.id)
        _log.info(
            "Saved message %s  role=%s  user=%s  session=%s",
            msg_id, role, user_id, session_row.id,
        )
    except Exception:
        db.rollback()
        _log.exception("Failed to save message to PostgreSQL")
        raise
    finally:
        db.close()

    # --- Vector store (best-effort — failure here must not block chat) ---
    try:
        vec_meta = {
            "user_id": user_id,
            "role": role,
            "text": content,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            **{k: v for k, v in metadata.items() if isinstance(v, (str, int, float, bool))},
        }
        vector_store.upsert(msg_id, content, vec_meta)
    except Exception:
        _log.warning("Vector store upsert failed for msg %s (non-fatal)", msg_id, exc_info=True)


def get_history(user_id: str, limit: int = 50) -> list[dict]:
    """
    Retrieve recent conversation history for a user, ordered by timestamp
    ascending (oldest first).

    Args:
        user_id: The unique identifier of the user.
        limit: Maximum number of messages to return. Defaults to 50.

    Returns:
        A list of message dicts with keys:
            id, role, content, timestamp, session_id, metadata

    Example:
        history = get_history("owner", limit=20)
        for msg in history:
            print(msg["role"], msg["content"])
    """
    db = get_session()
    try:
        user = _resolve_user_by_name(db, user_id)
        if user is None:
            _log.info("get_history: no user found for user_id=%s", user_id)
            return []

        stmt = (
            select(Message)
            .where(Message.user_id == user.id)
            .order_by(Message.timestamp.desc())
            .limit(limit)
        )
        messages = list(db.scalars(stmt).all())
        messages.reverse()  # return oldest-first

        result = [
            {
                "id": str(m.id),
                "role": m.role.value if isinstance(m.role, MessageRole) else m.role,
                "content": m.content,
                "timestamp": m.timestamp.isoformat() if m.timestamp else None,
                "session_id": str(m.session_id) if m.session_id else None,
                "metadata": m.metadata_ or {},
            }
            for m in messages
        ]
        _log.info("get_history user=%s  returned=%d", user_id, len(result))
        return result

    finally:
        db.close()


def get_relevant_context(
    user_id: str,
    query: str,
    top_k: int = 5,
) -> list[dict]:
    """
    Retrieve semantically relevant context from memory using vector search.

    Args:
        user_id: The unique identifier of the user.
        query: The query string to find relevant past context for.
        top_k: Number of top relevant results to return. Defaults to 5.

    Returns:
        A list of message dicts ranked by relevance, each with keys:
            id, score, role, content, timestamp, metadata

    Example:
        context = get_relevant_context("owner", "OAuth token setup", top_k=3)
    """
    # Build backend-appropriate filter for user scoping
    # DECISION: Use metadata filter on user_id to scope vector search
    # WHY: Prevents leaking other users' memories in multi-user setups
    filters: dict[str, Any] | None = None

    # Chroma uses {"user_id": value}, Supabase uses {"user_id": value}
    # Both backends accept this format through our unified API
    if user_id:
        filters = {"user_id": user_id}

    try:
        raw_results = vector_store.search(query, top_k=top_k, filters=filters)
    except Exception:
        _log.warning(
            "Vector search failed for user=%s query=%r (returning empty)",
            user_id, query, exc_info=True,
        )
        return []

    results = []
    for r in raw_results:
        meta = r.get("metadata", {})
        results.append(
            {
                "id": r.get("id", ""),
                "score": r.get("score", 0.0),
                "role": meta.get("role", "unknown"),
                "content": meta.get("text", ""),
                "timestamp": meta.get("timestamp"),
                "metadata": meta,
            }
        )

    _log.info(
        "get_relevant_context user=%s  query=%r  returned=%d",
        user_id, query[:60], len(results),
    )
    return results


def compress_old_sessions(
    user_id: str,
    older_than_days: int = 30,
) -> None:
    """
    Compress old conversation sessions into summarised memory entries.

    For each session that ended more than *older_than_days* ago:
      1. Collect all messages in the session.
      2. Generate an LLM summary via the default engine.
      3. Store the summary as a CompressedMemory row.
      4. Delete the original Message rows to free space.
      5. Delete the corresponding vectors from the vector store.

    If no LLM engine is available, the session messages are concatenated
    into a simple text summary as a fallback.

    Args:
        user_id: The unique identifier of the user.
        older_than_days: Compress sessions older than this many days.

    Returns:
        None

    Example:
        compress_old_sessions("owner", older_than_days=14)
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=older_than_days)

    db = get_session()
    try:
        user = _resolve_user_by_name(db, user_id)
        if user is None:
            _log.info("compress: no user found for user_id=%s", user_id)
            return

        # Find sessions that have ended before the cutoff
        stmt = (
            select(Session)
            .where(
                Session.user_id == user.id,
                Session.ended_at.isnot(None),
                Session.ended_at < cutoff,
                Session.summary.is_(None),  # not yet compressed
            )
        )
        sessions = list(db.scalars(stmt).all())

        if not sessions:
            _log.info("compress: no eligible sessions for user=%s", user_id)
            return

        _log.info(
            "compress: found %d sessions to compress for user=%s",
            len(sessions), user_id,
        )

        for sess in sessions:
            # Gather messages
            msg_stmt = (
                select(Message)
                .where(Message.session_id == sess.id)
                .order_by(Message.timestamp.asc())
            )
            messages = list(db.scalars(msg_stmt).all())

            if not messages:
                sess.summary = "(empty session)"
                db.commit()
                continue

            # Build transcript for summarisation
            transcript_lines = [
                f"[{m.role.value if isinstance(m.role, MessageRole) else m.role}] {m.content}"
                for m in messages
            ]
            transcript = "\n".join(transcript_lines)

            # Attempt LLM summarisation
            summary = _llm_summarize(transcript)

            # Determine date range
            timestamps = [m.timestamp for m in messages if m.timestamp]
            date_start = min(timestamps) if timestamps else sess.started_at
            date_end = max(timestamps) if timestamps else (sess.ended_at or sess.started_at)

            # Create CompressedMemory
            cm = CompressedMemory(
                user_id=user.id,
                session_id=sess.id,
                summary=summary,
                original_message_count=len(messages),
                date_range_start=date_start,
                date_range_end=date_end,
            )
            db.add(cm)

            # Mark session as compressed
            sess.summary = summary

            # Collect message IDs for vector deletion
            msg_ids = [str(m.id) for m in messages]

            # Delete original messages
            for m in messages:
                db.delete(m)

            db.commit()

            # Delete vectors (best-effort)
            try:
                if msg_ids:
                    vector_store.delete(msg_ids)
            except Exception:
                _log.warning(
                    "Failed to delete vectors for session %s (non-fatal)",
                    sess.id, exc_info=True,
                )

            _log.info(
                "Compressed session %s: %d messages → summary (%d chars)",
                sess.id, len(msg_ids), len(summary),
            )

    except Exception:
        db.rollback()
        _log.exception("compress_old_sessions failed")
        raise
    finally:
        db.close()


# ===========================================================================
# LLM summarisation (internal)
# ===========================================================================

def _llm_summarize(transcript: str) -> str:
    """
    Summarise a conversation transcript using the default LLM engine.

    Falls back to a simple truncation if no engine is available.

    Args:
        transcript: Newline-separated conversation transcript.

    Returns:
        A summary string.
    """
    prompt = (
        "You are a memory compression assistant. Summarise the following "
        "conversation into a concise paragraph. Preserve key facts, decisions, "
        "and action items. Do not add information that is not in the transcript.\n\n"
        f"--- TRANSCRIPT ---\n{transcript}\n--- END ---\n\nSummary:"
    )

    # Try to use the engines module (may not be implemented yet)
    try:
        from engines.base import BaseEngine  # noqa: F401
        from core.orchestrator import route  # noqa: F401

        engine = route("reasoning")
        summary = engine.generate(prompt, context=[])
        if summary and summary.strip():
            return summary.strip()
    except Exception:
        _log.debug("LLM summarisation not available, using fallback", exc_info=True)

    # Fallback: simple truncation
    max_len = 1000
    if len(transcript) <= max_len:
        return f"[Auto-summary] {transcript}"
    return f"[Auto-summary] {transcript[:max_len]}..."
