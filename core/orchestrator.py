"""
orchestrator.py

Routes tasks to the appropriate engine based on task type and auth availability.
Integrates AuthManager with multi-provider engine initialization.
Part of Orion - Persistent AI Companion System.
"""

from __future__ import annotations

import logging
from typing import Optional

import config
from engines.auth.manager import get_auth_manager
from engines.base import BaseEngine
from engines.claude_engine import ClaudeEngine
from engines.gemini_engine import GeminiEngine
from engines.groq_engine import GroqEngine
from engines.local_engine import LocalEngine
from engines.openai_engine import OpenAIEngine
from engines.openrouter_engine import OpenRouterEngine

_log = logging.getLogger("orion.orchestrator")
_handler = logging.FileHandler(config.LOGS_DIR / "orchestrator.log")
_handler.setFormatter(logging.Formatter("%(asctime)s  %(levelname)-8s  %(message)s"))
_log.addHandler(_handler)
_log.setLevel(getattr(logging, config.LOG_LEVEL, logging.INFO))

_ENGINE_INSTANCES: dict[str, BaseEngine] = {}
_AUTH_MANAGER = get_auth_manager()

_ENGINE_CLASS_MAP = {
    "anthropic": ClaudeEngine,
    "openai": OpenAIEngine,
    "gemini": GeminiEngine,
    "openrouter": OpenRouterEngine,
    "groq": GroqEngine,
    "local": LocalEngine,
    "ollama": LocalEngine,
}

_PRIORITY_MAP: dict[str, list[str]] = {
    "reasoning": ["anthropic", "openai", "gemini", "openrouter", "groq", "local"],
    "code": ["openai", "anthropic", "groq", "openrouter", "local"],
    "fast": ["groq", "gemini", "local", "anthropic"],
    "multimodal": ["gemini", "openai", "anthropic"],
    "local": ["local"],
    "voice": ["openai", "anthropic", "gemini", "local"],
    "browser": ["openai", "anthropic", "openrouter", "local"],
    "agent": ["anthropic", "openai", "gemini", "local"],
    "vision": ["gemini", "openai", "anthropic"],
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


def _normalize_engine_name(name: str) -> str:
    """
    Normalize engine aliases to canonical provider keys.

    Args:
        name: Engine or provider name.

    Returns:
        Canonical engine key.
    """
    normalized = name.lower().strip()
    alias_map = {
        "claude": "anthropic",
        "ollama": "local",
    }
    return alias_map.get(normalized, normalized)


def _get_engine_instance(name: str) -> Optional[BaseEngine]:
    """
    Get or create an engine instance by provider key.

    Args:
        name: Provider key.

    Returns:
        Engine instance, or None on failure.
    """
    canonical = _normalize_engine_name(name)

    if canonical in _ENGINE_INSTANCES:
        return _ENGINE_INSTANCES[canonical]

    engine_class = _ENGINE_CLASS_MAP.get(canonical)
    if not engine_class:
        _log.error("Unknown engine/provider name: %s", name)
        return None

    try:
        instance = engine_class()
        _ENGINE_INSTANCES[canonical] = instance
        return instance
    except Exception as exc:
        _log.error("Failed to create engine '%s': %s", canonical, exc)
        return None


def get_available_engines() -> dict[str, BaseEngine]:
    """
    Return currently available engine instances keyed by provider name.

    Availability is based on AuthManager provider readiness and engine health.

    Returns:
        Dict of provider -> engine instance.
    """
    available: dict[str, BaseEngine] = {}

    available_providers = set(_AUTH_MANAGER.get_available_providers())
    if "ollama" in available_providers:
        available_providers.add("local")

    for provider in available_providers:
        canonical = _normalize_engine_name(provider)
        engine = _get_engine_instance(canonical)
        if engine and engine.is_available():
            available[canonical] = engine

    _log.info("Available engines: %s", sorted(available.keys()))
    return available


def route(task_type: str) -> BaseEngine:
    """
    Route task to the best available engine by priority.

    Priority order:
        - reasoning  -> anthropic > openai > gemini > openrouter > groq > local
        - code       -> openai > anthropic > groq > openrouter > local
        - fast       -> groq > gemini > local > anthropic
        - multimodal -> gemini > openai > anthropic
        - local      -> ollama/local

    Args:
        task_type: Task type key.

    Returns:
        Selected engine instance.

    Raises:
        RuntimeError: If no suitable engine is available.
    """
    normalized_task = task_type.lower().strip()

    if normalized_task == "local":
        local_engine = _get_engine_instance("local")
        if local_engine:
            return local_engine

    available = get_available_engines()
    priorities = _PRIORITY_MAP.get(normalized_task, _PRIORITY_MAP["reasoning"])

    for provider in priorities:
        canonical = _normalize_engine_name(provider)
        engine = available.get(canonical)
        if engine:
            _log.info("Routed task '%s' to engine '%s'", task_type, canonical)
            return engine

    status = _AUTH_MANAGER.get_provider_status()
    missing = [name for name, details in status.items() if not details.get("available")]
    missing_text = ", ".join(sorted(missing)) if missing else "none"

    raise RuntimeError(
        "No LLM engines are available for task type "
        f"'{task_type}'. Configure providers with python scripts/setup.py. "
        f"Missing credentials/providers: {missing_text}."
    )


def route_to_agent(task: str) -> str:
    """
    Determine agent type based on keyword matching.

    Args:
        task: Task description text.

    Returns:
        Agent type name.
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


def get_engine_by_name(name: str) -> Optional[BaseEngine]:
    """
    Get specific engine by provider key if available.

    Args:
        name: Provider or engine key.

    Returns:
        Engine instance or None.
    """
    canonical = _normalize_engine_name(name)
    available = get_available_engines()
    engine = available.get(canonical)
    if engine:
        return engine

    _log.warning("Engine '%s' requested but not available", name)
    return None


def log_startup_status() -> None:
    """Log provider and engine availability status on startup."""
    _log.info("=== Orion Engine Startup Status ===")

    provider_status = _AUTH_MANAGER.get_provider_status()
    for provider in [
        "anthropic",
        "openai",
        "gemini",
        "openrouter",
        "groq",
        "mistral",
        "ollama",
    ]:
        details = provider_status.get(provider, {})
        available = details.get("available", False)
        auth_type = details.get("auth_type", "unknown")
        model = details.get("model", "unknown")
        status = "available" if available else "unavailable"
        _log.info(
            "provider=%s status=%s auth=%s model=%s",
            provider,
            status,
            auth_type,
            model,
        )

    available_engines = get_available_engines()
    if available_engines:
        _log.info("Available engines: %s", ", ".join(sorted(available_engines.keys())))
    else:
        _log.warning("No engines available")

    _log.info("===================================")


log_startup_status()
