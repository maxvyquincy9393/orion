"""
nodes.py

Individual agent task nodes for the LangGraph agent system.
Each node performs a specific step in the agent execution pipeline.
Part of Orion — Persistent AI Companion System.
"""

import logging
from typing import Any

import config
from agents.state import AgentState

_log = logging.getLogger("orion.agents.nodes")
_handler = logging.FileHandler(config.LOGS_DIR / "agents.log")
_handler.setFormatter(logging.Formatter("%(asctime)s  %(levelname)-8s  %(message)s"))
_log.addHandler(_handler)
_log.setLevel(getattr(logging, config.LOG_LEVEL, logging.INFO))


def supervisor_node(state: AgentState) -> AgentState:
    """
    Supervisor node that analyzes the task and determines next steps.

    This is the entry point for all agent tasks. It:
    1. Analyzes the task description
    2. Determines which sub-agents to invoke
    3. Sets up the execution plan

    Args:
        state: Current agent state.

    Returns:
        Updated agent state with execution plan.

    Example:
        state = supervisor_node(state)
    """
    task = state.task
    _log.info("Supervisor analyzing task: %s", task[:100])

    state.current_step = "supervisor"

    task_lower = task.lower()

    next_steps = []

    if any(
        kw in task_lower
        for kw in ["remember", "recall", "memory", "previous", "last time", "history"]
    ):
        next_steps.append("memory")

    if any(
        kw in task_lower
        for kw in ["search", "find", "look up", "research", "browse", "web"]
    ):
        next_steps.append("search")

    if any(
        kw in task_lower for kw in ["code", "implement", "write", "program", "function"]
    ):
        next_steps.append("code")

    if any(
        kw in task_lower
        for kw in ["summarize", "summarise", "summary", "brief", "overview"]
    ):
        next_steps.append("summarize")

    if not next_steps:
        next_steps.append("memory")

    state.add_result(
        "supervisor",
        {
            "plan": next_steps,
            "task_type": _classify_task(task),
        },
    )

    _log.info("Supervisor plan: %s", next_steps)
    return state


def _classify_task(task: str) -> str:
    """
    Classify the task type based on keywords.

    Args:
        task: Task description.

    Returns:
        Task type string.

    Example:
        task_type = _classify_task("Search for Python tutorials")
        # Returns: "search"
    """
    task_lower = task.lower()

    if any(kw in task_lower for kw in ["search", "find", "look up", "research"]):
        return "search"
    if any(kw in task_lower for kw in ["code", "implement", "program"]):
        return "code"
    if any(kw in task_lower for kw in ["remember", "recall", "memory"]):
        return "memory"
    if any(kw in task_lower for kw in ["summarize", "summary"]):
        return "summarize"
    if any(kw in task_lower for kw in ["browse", "navigate", "website"]):
        return "browse"

    return "general"


def memory_node(state: AgentState) -> AgentState:
    """
    Memory node that retrieves relevant memories for the task.

    Queries the persistent memory system to find relevant context
    from past conversations and stored facts.

    Args:
        state: Current agent state.

    Returns:
        Updated agent state with retrieved memories.

    Example:
        state = memory_node(state)
    """
    task = state.task
    _log.info("Memory node retrieving context for: %s", task[:100])

    state.current_step = "memory"

    try:
        import core.memory as memory

        user_id = config.DEFAULT_USER_ID

        relevant = memory.get_relevant_context(user_id, task, top_k=5)

        state.memory = relevant

        memory_texts = [m.get("content", "") for m in relevant if m.get("content")]
        context_summary = (
            "\n".join(memory_texts[:3])
            if memory_texts
            else "No relevant memories found."
        )

        state.add_result(
            "memory",
            {
                "memories_found": len(relevant),
                "summary": context_summary[:500],
            },
        )

        _log.info("Memory node found %d relevant memories", len(relevant))

    except Exception as exc:
        _log.error("Memory node failed: %s", exc)
        state.add_result(
            "memory",
            {
                "error": str(exc),
                "memories_found": 0,
            },
        )

    return state


def summarize_node(state: AgentState) -> AgentState:
    """
    Summarize node that creates a summary of gathered information.

    Takes all results from previous nodes and creates a coherent summary.

    Args:
        state: Current agent state.

    Returns:
        Updated agent state with summary.

    Example:
        state = summarize_node(state)
    """
    _log.info("Summarize node processing results")

    state.current_step = "summarize"

    all_results = state.results

    summary_parts = []
    for r in all_results:
        node = r.get("node", "unknown")
        result = r.get("result", {})
        if isinstance(result, dict):
            if "summary" in result:
                summary_parts.append(f"[{node}] {result['summary']}")
            elif "memories_found" in result:
                summary_parts.append(
                    f"[{node}] Found {result['memories_found']} relevant memories"
                )

    final_summary = (
        "\n".join(summary_parts) if summary_parts else "No results to summarize."
    )

    state.add_result(
        "summarize",
        {
            "final_summary": final_summary,
            "steps_completed": len(all_results),
        },
    )

    state.status = "complete"
    _log.info("Summarize node completed with %d steps", len(all_results))

    return state


def search_node(state: AgentState) -> AgentState:
    """
    Search node that performs web searches.

    Note: This is a stub for Phase 2. Will be implemented with
    DuckDuckGo / SearXNG integration.

    Args:
        state: Current agent state.

    Returns:
        Updated agent state.

    Raises:
        NotImplementedError: This node is not yet implemented.
    """
    raise NotImplementedError(
        "search_node is not implemented yet - coming in Phase 2. "
        "Use browser/search.py directly for now."
    )


def code_node(state: AgentState) -> AgentState:
    """
    Code node that generates or analyzes code.

    Note: This is a stub for Phase 2. Will be implemented with
    full code generation capabilities.

    Args:
        state: Current agent state.

    Returns:
        Updated agent state.

    Raises:
        NotImplementedError: This node is not yet implemented.
    """
    raise NotImplementedError(
        "code_node is not implemented yet - coming in Phase 2. "
        "Use orchestrator.route('code') directly for now."
    )


def error_handler_node(state: AgentState) -> AgentState:
    """
    Error handler node that processes errors from other nodes.

    Logs the error and prepares an error response.

    Args:
        state: Current agent state.

    Returns:
        Updated agent state with error information.
    """
    error = state.error
    _log.error("Error handler processing: %s", error)

    state.current_step = "error_handler"
    state.add_result(
        "error_handler",
        {
            "error_message": error,
            "status": "handled",
        },
    )

    return state
