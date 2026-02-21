"""
models.py

SQLAlchemy ORM models for the Orion database.
Defines the schema for users, messages, threads, and triggers
stored in PostgreSQL.
Part of Orion — Persistent AI Companion System.
"""

from sqlalchemy import Column, String, Text, DateTime, Integer, Boolean, JSON, ForeignKey
from sqlalchemy.orm import declarative_base, relationship
from datetime import datetime

Base = declarative_base()


class User(Base):
    """
    Represents a user in the Orion system.
    """

    __tablename__ = "users"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    settings = Column(JSON, default=dict)

    messages = relationship("Message", back_populates="user")
    threads = relationship("Thread", back_populates="user")


class Message(Base):
    """
    Represents a single message in a conversation.
    Stored permanently for cross-session memory.
    """

    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    role = Column(String, nullable=False)  # "user", "assistant", "system"
    content = Column(Text, nullable=False)
    metadata_ = Column("metadata", JSON, default=dict)
    thread_id = Column(String, ForeignKey("threads.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="messages")
    thread = relationship("Thread", back_populates="messages")


class Thread(Base):
    """
    Represents a conversation thread.
    Tracks state: open → waiting → resolved.
    """

    __tablename__ = "threads"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    trigger = Column(String, nullable=False)
    state = Column(String, default="open")  # "open", "waiting", "resolved"
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", back_populates="threads")
    messages = relationship("Message", back_populates="thread")


class CompressedMemory(Base):
    """
    Stores compressed summaries of old conversation sessions.
    Used for long-term memory retrieval without storing every message.
    """

    __tablename__ = "compressed_memories"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    summary = Column(Text, nullable=False)
    original_message_count = Column(Integer, nullable=False)
    date_range_start = Column(DateTime, nullable=False)
    date_range_end = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class TriggerLog(Base):
    """
    Logs all proactive triggers that were fired.
    Used for analysis and tuning trigger sensitivity.
    """

    __tablename__ = "trigger_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    trigger_type = Column(String, nullable=False)
    reason = Column(Text, nullable=False)
    urgency = Column(String, default="medium")
    acted_on = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
