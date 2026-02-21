"""
orchestrator.py

Routes tasks to the appropriate LLM engine based on task type.
Determines whether to use GPT-4, Claude, Gemini, or a local model
depending on the nature of the request.
Part of Orion — Persistent AI Companion System.
"""

import logging
import re
from typing import Optional

import config
from engines.base import BaseEngine
from engines.claude_engine import ClaudeEngine
from engines.gemini_engine import GeminiEngine
from engines.local_engine import LocalEngine
from engines.openai_engine import OpenAIEngine

_log = logging.getLogger("orion.orchestrator")
_handler = logging.FileHandler(config.LOGS_DIR / "orchestrator.log")
_handler.setFormatter(logging.Formatter("%(asctime)s  %(levelname)-8s  %(message)s"))
_log.addHandler(_handler)
_log.setLevel(getattr(logging, config.LOG_LEVEL, logging.INFO))

_ENGINE_INSTANCES: dict[str, BaseEngine] = {}

_PRIORITY_MAP: dict[str, list[str]] = {
    "reasoning": ["claude", "openai", "gemini", "local"],
    "code": ["openai", "claude", "local"],
    "fast": ["gemini", "local"],
    "multimodal": ["gemini", "openai"],
    "voice": ["openai", "claude"],
    "browser": ["openai", "claude"],
    "agent": ["claude", "openai"],
    "vision": ["gemini", "openai"],
}

_AGENT_KEYWORDS: dict[str, list[str]] = {
    "research": [
        "research",
        "find information",
        "look up",
        "search for",
        "investigate",
    ],
    "browsing": ["browse", "navigate to", "visit website", "open url", "go to"],
    "file": ["create file", "edit file", "delete file", "read file", "write file"],
    "calendar": ["schedule", "meeting", "appointment", "calendar", "event"],
    "system": ["run command", "execute", "terminal", "open app", "launch"],
    "code": ["write code", "implement", "debug", "refactor", "fix bug"],
    "analysis": ["analyze", "compare", "evaluate", "assess", "review"],
}


def _get_engine_instance(name: str) -> Optional[BaseEngine]:
    """
    Get or create an engine instance by name.

    Args:
        name: Engine name — "openai", "claude", "gemini", or "local".

    Returns:
        BaseEngine instance or None if creation fails.
    """
    if name in _ENGINE_INSTANCES:
        return _ENGINE_INSTANCES[name]

    engine_map = {
        "openai": OpenAIEngine,
        "claude": ClaudeEngine,
        "gemini": GeminiEngine,
        "local": LocalEngine,
    }

    engine_class = engine_map.get(name)
    if not engine_class:
        _log.error("Unknown engine name: %s", name)
        return None

    try:
        instance = engine_class()
        _ENGINE_INSTANCES[name] = instance
        return instance
    except Exception as exc:
        _log.error("Failed to create engine '%s': %s", name, exc)
        return None


def route(task_type: str) -> BaseEngine:
    """
    Route a task to the most suitable LLM engine.

    Priority order per task type:
        - reasoning: Claude → GPT → Gemini → local
        - code: GPT → Claude → local
        - fast: Gemini → local
        - multimodal: Gemini → GPT
        - voice: GPT → Claude
        - browser: GPT → Claude
        - agent: Claude → GPT
        - vision: Gemini → GPT

    Args:
        task_type: The type of task to route. One of:
            "reasoning", "code", "fast", "multimodal", "voice", "browser",
            "agent", "vision"

    Returns:
        An instance of the appropriate BaseEngine subclass.

    Raises:
        RuntimeError: If no engines are available.

    Example:
        engine = route("reasoning")
        response = engine.generate(prompt, context)
    """
    priorities = _PRIORITY_MAP.get(task_type, ["claude", "openai", "gemini", "local"])

    for engine_name in priorities:
        engine = _get_engine_instance(engine_name)
        if engine and engine.is_available():
            _log.info("Routed task '%s' to engine '%s'", task_type, engine_name)
            return engine

    for engine_name in ["local", "claude", "openai", "gemini"]:
        if engine_name not in priorities:
            engine = _get_engine_instance(engine_name)
            if engine and engine.is_available():
                _log.info(
                    "Routed task '%s' to fallback engine '%s'",
                    task_type,
                    engine_name,
                )
                return engine

    _log.error("No engines available for task '%s'", task_type)
    raise RuntimeError(f"No LLM engines available for task type: {task_type}")


def route_to_agent(task: str) -> str:
    """
    Determine the agent type based on task description keywords.

    Analyzes the task string for keywords and returns the most
    appropriate agent type.

    Args:
        task: The task description string.

    Returns:
        An agent type string: "research", "browsing", "file", "calendar",
        "system", "code", "analysis", or "general".

    Example:
        agent_type = route_to_agent("Search for the latest AI news")
        # Returns: "research"
    """
    task_lower = task.lower()

    scores: dict[str, int] = {agent: 0 for agent in _AGENT_KEYWORDS}
    scores["general"] = 0

    for agent_type, keywords in _AGENT_KEYWORDS.items():
        for keyword in keywords:
            if keyword in task_lower:
                scores[agent_type] += 1

    max_score = max(scores.values())
    if max_score == 0:
        _log.debug("No agent keywords matched, defaulting to 'general'")
        return "general"

    for agent_type, score in scores.items():
        if score == max_score:
            _log.info("Routed task to agent type '%s' (score: %d)", agent_type, score)
            return agent_type

    return "general"


def get_available_engines() -> list[str]:
    """
    Return a list of currently available and healthy engine names.

    Checks each engine via is_available() and returns only those
    that can accept requests.

    Returns:
        A list of engine name strings that are ready to accept requests.

    Example:
        engines = get_available_engines()
        # ["openai", "claude", "local"]
    """
    available = []
    engine_names = ["claude", "openai", "gemini", "local"]

    for name in engine_names:
        engine = _get_engine_instance(name)
        if engine and engine.is_available():
            available.append(name)

    _log.info("Available engines: %s", available)
    return available


def get_engine_by_name(name: str) -> Optional[BaseEngine]:
    """
    Get a specific engine by its name, bypassing automatic routing.

    Args:
        name: The engine name — "openai", "claude", "gemini", or "local".

    Returns:
        An instance of the specified BaseEngine subclass, or None if
        the engine is not available.

    Example:
        engine = get_engine_by_name("claude")
    """
    engine = _get_engine_instance(name)
    if engine and engine.is_available():
        return engine
    _log.warning("Engine '%s' requested but not available", name)
    return None


def log_startup_status() -> None:
    """
    Log which engines are available on startup.

    Should be called once when the application starts.
    """
    _log.info("=== Orion Engine Startup Status ===")
    available = get_available_engines()

    if available:
        _log.info("Available engines: %s", ", ".join(available))
    else:
        _log.warning("No LLM engines available!")

    for name in ["claude", "openai", "gemini", "local"]:
        engine = _get_engine_instance(name)
        if engine:
            status = "[OK] available" if engine.is_available() else "[--] unavailable"
            _log.info("  %s: %s", name, status)
        else:
            _log.info("  %s: [--] failed to initialise", name)

    _log.info("===================================")


log_startup_status()
