"""
intelligence.py

Proactive pattern detection and user behavior analysis.
Learns from conversation history to provide intelligent suggestions.
Part of Orion - Persistent AI Companion System.
"""

import json
import logging
import re
from collections import Counter
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Optional

import config

_log = logging.getLogger("orion.intelligence")
_handler = logging.FileHandler(config.LOGS_DIR / "intelligence.log")
_handler.setFormatter(logging.Formatter("%(asctime)s | %(levelname)-8s | %(message)s"))
_log.addHandler(_handler)
_log.setLevel(getattr(logging, config.LOG_LEVEL, logging.INFO))

PATTERNS_FILE = config.DATA_DIR / "patterns.json"
TRIGGER_WEIGHTS_FILE = config.DATA_DIR / "trigger_weights.json"


class PatternIntelligence:
    """
    Proactive pattern detection and user behavior analysis.

    Analyzes conversation history to:
    - Detect recurring patterns in user behavior
    - Suggest proactive actions based on context
    - Learn trigger weights for common tasks
    - Build user profile summary

    Attributes:
        patterns: Detected behavioral patterns.
        trigger_weights: Weights for different trigger types.
        user_summary: Summary of user preferences and behavior.

    Example:
        intel = PatternIntelligence()
        patterns = intel.analyze_history(messages)
        suggestions = intel.suggest_proactive_actions(current_context)
    """

    def __init__(self, user_id: Optional[str] = None):
        """
        Initialize the PatternIntelligence instance.

        Args:
            user_id: Optional user ID for multi-user scenarios.
        """
        self.user_id = user_id or config.DEFAULT_USER_ID
        self.patterns: dict[str, Any] = {}
        self.trigger_weights: dict[str, float] = {}
        self.user_summary: dict[str, Any] = {}

        self._load_patterns()
        self._load_trigger_weights()
        _log.info("PatternIntelligence initialized for user: %s", self.user_id)

    def analyze_history(
        self,
        messages: list[dict],
        window_days: int = 30,
    ) -> dict[str, Any]:
        """
        Analyze conversation history for patterns.

        Looks for:
        - Recurring topics and keywords
        - Time-based patterns (morning/evening activity)
        - Task type frequencies
        - Common request sequences

        Args:
            messages: List of conversation messages.
            window_days: Number of days to analyze. Defaults to 30.

        Returns:
            Dictionary of detected patterns.

        Example:
            patterns = intel.analyze_history(recent_messages)
        """
        _log.info(
            "ANALYZE_HISTORY | user=%s | messages=%d | window=%d days",
            self.user_id,
            len(messages),
            window_days,
        )

        cutoff = datetime.now() - timedelta(days=window_days)

        patterns = {
            "topics": Counter(),
            "task_types": Counter(),
            "time_patterns": {"morning": 0, "afternoon": 0, "evening": 0, "night": 0},
            "keywords": Counter(),
            "sequences": [],
            "engines_used": Counter(),
        }

        recent_messages = []
        for msg in messages:
            timestamp_str = msg.get("timestamp", "")
            try:
                if timestamp_str:
                    msg_time = datetime.fromisoformat(
                        timestamp_str.replace("Z", "+00:00")
                    )
                    if msg_time.replace(tzinfo=None) >= cutoff:
                        recent_messages.append(msg)
            except (ValueError, TypeError):
                recent_messages.append(msg)

        for msg in recent_messages:
            role = msg.get("role", "")
            content = msg.get("content", "")
            metadata = msg.get("metadata", {})

            if role == "user":
                self._extract_topics(content, patterns["topics"])
                self._extract_keywords(content, patterns["keywords"])
                self._classify_task(content, patterns["task_types"])

            if timestamp_str := msg.get("timestamp"):
                try:
                    msg_time = datetime.fromisoformat(
                        timestamp_str.replace("Z", "+00:00")
                    )
                    hour = msg_time.hour
                    if 6 <= hour < 12:
                        patterns["time_patterns"]["morning"] += 1
                    elif 12 <= hour < 18:
                        patterns["time_patterns"]["afternoon"] += 1
                    elif 18 <= hour < 22:
                        patterns["time_patterns"]["evening"] += 1
                    else:
                        patterns["time_patterns"]["night"] += 1
                except (ValueError, TypeError):
                    pass

            if engine := metadata.get("engine"):
                patterns["engines_used"][engine] += 1

        sequences = self._detect_sequences(recent_messages)
        patterns["sequences"] = sequences[:10]

        self.patterns = {
            "topics": dict(patterns["topics"].most_common(20)),
            "task_types": dict(patterns["task_types"].most_common(10)),
            "time_patterns": patterns["time_patterns"],
            "keywords": dict(patterns["keywords"].most_common(30)),
            "sequences": patterns["sequences"],
            "engines_used": dict(patterns["engines_used"]),
            "analysis_timestamp": datetime.now().isoformat(),
            "messages_analyzed": len(recent_messages),
        }

        self._save_patterns()

        _log.info(
            "ANALYZE_COMPLETE | topics=%d | task_types=%d | keywords=%d",
            len(self.patterns["topics"]),
            len(self.patterns["task_types"]),
            len(self.patterns["keywords"]),
        )

        return self.patterns

    def suggest_proactive_actions(
        self,
        current_context: Optional[str] = None,
        time_of_day: Optional[int] = None,
    ) -> list[dict]:
        """
        Suggest proactive actions based on detected patterns.

        Analyzes current context and historical patterns to suggest
        actions the user might want to take.

        Args:
            current_context: Current conversation or task context.
            time_of_day: Current hour (0-23). Defaults to now.

        Returns:
            List of suggested action dictionaries.

        Example:
            suggestions = intel.suggest_proactive_actions("working on code", 14)
        """
        _log.info(
            "SUGGEST_PROACTIVE | context='%s' | time=%s",
            (current_context or "")[:50],
            time_of_day,
        )

        suggestions = []

        if time_of_day is None:
            time_of_day = datetime.now().hour

        time_suggestions = self._get_time_based_suggestions(time_of_day)
        suggestions.extend(time_suggestions)

        if current_context:
            context_suggestions = self._get_context_suggestions(current_context)
            suggestions.extend(context_suggestions)

        sequence_suggestions = self._get_sequence_suggestions()
        suggestions.extend(sequence_suggestions)

        for suggestion in suggestions:
            trigger = suggestion.get("trigger", "general")
            suggestion["confidence"] = self.trigger_weights.get(trigger, 0.5)

        suggestions.sort(key=lambda x: x.get("confidence", 0), reverse=True)

        suggestions = suggestions[:5]

        _log.info("SUGGEST_PROACTIVE | suggestions=%d", len(suggestions))
        return suggestions

    def update_trigger_weights(
        self,
        trigger: str,
        outcome: str,
        feedback: Optional[float] = None,
    ) -> float:
        """
        Update trigger weights based on user feedback.

        Reinforcement learning for trigger suggestions based on
        whether the user accepted or rejected the suggestion.

        Args:
            trigger: The trigger type that was activated.
            outcome: "accepted", "rejected", or "ignored".
            feedback: Optional explicit feedback score (0.0-1.0).

        Returns:
            The updated weight value.

        Example:
            new_weight = intel.update_trigger_weights("morning_summary", "accepted")
        """
        current_weight = self.trigger_weights.get(trigger, 0.5)

        if feedback is not None:
            adjustment = (feedback - current_weight) * 0.3
        else:
            if outcome == "accepted":
                adjustment = 0.1
            elif outcome == "rejected":
                adjustment = -0.15
            else:
                adjustment = -0.02

        new_weight = max(0.0, min(1.0, current_weight + adjustment))
        self.trigger_weights[trigger] = new_weight

        self._save_trigger_weights()

        _log.info(
            "UPDATE_TRIGGER | trigger='%s' | outcome='%s' | weight=%.2f -> %.2f",
            trigger,
            outcome,
            current_weight,
            new_weight,
        )

        return new_weight

    def get_user_summary(self) -> dict[str, Any]:
        """
        Get a summary of the user's preferences and behavior.

        Returns:
            Dictionary containing user profile summary.

        Example:
            summary = intel.get_user_summary()
        """
        _log.info("GET_USER_SUMMARY | user=%s", self.user_id)

        summary = {
            "user_id": self.user_id,
            "preferred_time": self._get_preferred_time(),
            "top_topics": list(self.patterns.get("topics", {}).keys())[:5],
            "common_tasks": list(self.patterns.get("task_types", {}).keys())[:5],
            "preferred_engine": self._get_preferred_engine(),
            "interaction_style": self._infer_interaction_style(),
            "last_updated": datetime.now().isoformat(),
        }

        self.user_summary = summary
        return summary

    def _extract_topics(self, text: str, topics_counter: Counter) -> None:
        """Extract topic categories from text."""
        topic_keywords = {
            "coding": [
                "code",
                "function",
                "debug",
                "implement",
                "python",
                "javascript",
                "api",
            ],
            "research": [
                "search",
                "find",
                "research",
                "look up",
                "investigate",
                "information",
            ],
            "scheduling": [
                "schedule",
                "meeting",
                "calendar",
                "event",
                "appointment",
                "reminder",
            ],
            "writing": ["write", "draft", "document", "email", "report", "article"],
            "analysis": ["analyze", "compare", "evaluate", "review", "assess", "data"],
            "learning": [
                "learn",
                "tutorial",
                "explain",
                "teach",
                "understand",
                "how to",
            ],
            "creative": [
                "create",
                "design",
                "generate",
                "brainstorm",
                "idea",
                "creative",
            ],
        }

        text_lower = text.lower()
        for topic, keywords in topic_keywords.items():
            if any(kw in text_lower for kw in keywords):
                topics_counter[topic] += 1

    def _extract_keywords(self, text: str, keywords_counter: Counter) -> None:
        """Extract significant keywords from text."""
        stop_words = {
            "the",
            "a",
            "an",
            "is",
            "are",
            "was",
            "were",
            "be",
            "been",
            "being",
            "have",
            "has",
            "had",
            "do",
            "does",
            "did",
            "will",
            "would",
            "could",
            "should",
            "may",
            "might",
            "must",
            "shall",
            "can",
            "need",
            "dare",
            "ought",
            "used",
            "to",
            "of",
            "in",
            "for",
            "on",
            "with",
            "at",
            "by",
            "from",
            "as",
            "into",
            "through",
            "during",
            "before",
            "after",
            "above",
            "below",
            "between",
            "under",
            "again",
            "further",
            "then",
            "once",
            "here",
            "there",
            "when",
            "where",
            "why",
            "how",
            "all",
            "each",
            "few",
            "more",
            "most",
            "other",
            "some",
            "such",
            "no",
            "nor",
            "not",
            "only",
            "own",
            "same",
            "so",
            "than",
            "too",
            "very",
            "just",
            "and",
            "but",
            "if",
            "or",
            "because",
            "until",
            "while",
            "this",
            "that",
            "these",
            "those",
            "i",
            "me",
            "my",
            "myself",
            "we",
            "our",
            "ours",
            "you",
            "your",
            "yours",
            "he",
            "him",
            "his",
            "she",
            "her",
            "hers",
            "it",
            "its",
            "they",
            "them",
            "their",
            "what",
            "which",
            "who",
            "whom",
        }

        words = re.findall(r"\b[a-zA-Z]{3,}\b", text.lower())
        for word in words:
            if word not in stop_words:
                keywords_counter[word] += 1

    def _classify_task(self, text: str, task_counter: Counter) -> None:
        """Classify the task type from text."""
        text_lower = text.lower()

        task_keywords = {
            "question": ["what", "how", "why", "when", "where", "who", "which"],
            "command": ["do", "create", "make", "build", "generate", "write"],
            "search": ["search", "find", "look up", "research", "google"],
            "analysis": ["analyze", "compare", "evaluate", "review"],
            "conversation": ["hello", "hi", "thanks", "okay", "sure", "please"],
        }

        for task_type, keywords in task_keywords.items():
            if any(kw in text_lower for kw in keywords):
                task_counter[task_type] += 1
                break
        else:
            task_counter["other"] += 1

    def _detect_sequences(self, messages: list[dict]) -> list[dict]:
        """Detect common sequences of user actions."""
        sequences = []
        user_messages = [m for m in messages if m.get("role") == "user"]

        for i in range(len(user_messages) - 1):
            current = user_messages[i].get("content", "")[:50]
            next_msg = user_messages[i + 1].get("content", "")[:50]

            if current and next_msg:
                sequences.append(
                    {
                        "from": current,
                        "to": next_msg,
                        "count": 1,
                    }
                )

        merged = {}
        for seq in sequences:
            key = (seq["from"], seq["to"])
            if key in merged:
                merged[key]["count"] += 1
            else:
                merged[key] = seq

        return sorted(merged.values(), key=lambda x: x["count"], reverse=True)

    def _get_time_based_suggestions(self, hour: int) -> list[dict]:
        """Get suggestions based on time of day."""
        suggestions = []
        time_patterns = self.patterns.get("time_patterns", {})

        total = sum(time_patterns.values()) or 1
        current_period = self._get_time_period(hour)

        if time_patterns.get(current_period, 0) / total > 0.25:
            if current_period == "morning":
                suggestions.append(
                    {
                        "action": "morning_briefing",
                        "description": "Start with a morning briefing",
                        "trigger": "morning_routine",
                        "confidence": 0.7,
                    }
                )
            elif current_period == "afternoon":
                suggestions.append(
                    {
                        "action": "task_review",
                        "description": "Review tasks and priorities",
                        "trigger": "afternoon_review",
                        "confidence": 0.6,
                    }
                )
            elif current_period == "evening":
                suggestions.append(
                    {
                        "action": "daily_summary",
                        "description": "Get a summary of today's activities",
                        "trigger": "evening_summary",
                        "confidence": 0.7,
                    }
                )

        return suggestions

    def _get_time_period(self, hour: int) -> str:
        """Get time period name from hour."""
        if 6 <= hour < 12:
            return "morning"
        elif 12 <= hour < 18:
            return "afternoon"
        elif 18 <= hour < 22:
            return "evening"
        else:
            return "night"

    def _get_context_suggestions(self, context: str) -> list[dict]:
        """Get suggestions based on current context."""
        suggestions = []
        context_lower = context.lower()

        topics = self.patterns.get("topics", {})
        for topic in topics:
            if topic in context_lower and topics[topic] > 2:
                suggestions.append(
                    {
                        "action": f"continue_{topic}",
                        "description": f"Continue working on {topic}",
                        "trigger": f"context_{topic}",
                        "confidence": 0.6,
                    }
                )

        return suggestions

    def _get_sequence_suggestions(self) -> list[dict]:
        """Get suggestions based on detected sequences."""
        suggestions = []
        sequences = self.patterns.get("sequences", [])

        for seq in sequences[:3]:
            if seq.get("count", 0) >= 2:
                suggestions.append(
                    {
                        "action": "follow_sequence",
                        "description": f"Similar to: {seq['from'][:30]}...",
                        "trigger": "sequence_pattern",
                        "confidence": 0.5,
                    }
                )

        return suggestions

    def _get_preferred_time(self) -> str:
        """Get user's preferred interaction time."""
        time_patterns = self.patterns.get("time_patterns", {})
        if not time_patterns:
            return "unknown"

        return max(time_patterns, key=time_patterns.get)

    def _get_preferred_engine(self) -> str:
        """Get user's preferred engine."""
        engines = self.patterns.get("engines_used", {})
        if not engines:
            return "auto"

        return max(engines, key=engines.get)

    def _infer_interaction_style(self) -> str:
        """Infer user's interaction style."""
        task_types = self.patterns.get("task_types", {})
        if not task_types:
            return "balanced"

        total = sum(task_types.values())
        if total == 0:
            return "balanced"

        questions = task_types.get("question", 0)
        commands = task_types.get("command", 0)

        if questions / total > 0.5:
            return "inquisitive"
        elif commands / total > 0.5:
            return "directive"
        else:
            return "balanced"

    def _load_patterns(self) -> None:
        """Load patterns from file."""
        try:
            if PATTERNS_FILE.exists():
                with open(PATTERNS_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    self.patterns = data.get("patterns", {})
                    _log.debug("Loaded %d pattern entries", len(self.patterns))
        except Exception as exc:
            _log.warning("Could not load patterns: %s", exc)

    def _save_patterns(self) -> None:
        """Save patterns to file."""
        try:
            PATTERNS_FILE.parent.mkdir(parents=True, exist_ok=True)
            with open(PATTERNS_FILE, "w", encoding="utf-8") as f:
                json.dump(
                    {
                        "user_id": self.user_id,
                        "patterns": self.patterns,
                    },
                    f,
                    indent=2,
                )
            _log.debug("Saved patterns to %s", PATTERNS_FILE)
        except Exception as exc:
            _log.error("Could not save patterns: %s", exc)

    def _load_trigger_weights(self) -> None:
        """Load trigger weights from file."""
        try:
            if TRIGGER_WEIGHTS_FILE.exists():
                with open(TRIGGER_WEIGHTS_FILE, "r", encoding="utf-8") as f:
                    self.trigger_weights = json.load(f)
                    _log.debug("Loaded %d trigger weights", len(self.trigger_weights))
        except Exception as exc:
            _log.warning("Could not load trigger weights: %s", exc)

    def _save_trigger_weights(self) -> None:
        """Save trigger weights to file."""
        try:
            TRIGGER_WEIGHTS_FILE.parent.mkdir(parents=True, exist_ok=True)
            with open(TRIGGER_WEIGHTS_FILE, "w", encoding="utf-8") as f:
                json.dump(self.trigger_weights, f, indent=2)
            _log.debug("Saved trigger weights to %s", TRIGGER_WEIGHTS_FILE)
        except Exception as exc:
            _log.error("Could not save trigger weights: %s", exc)
