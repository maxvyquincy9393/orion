"""
graph.py

LangGraph state graph definition for Orion agent system.
Defines the execution flow between agent nodes.
Part of Orion — Persistent AI Companion System.
"""

import logging
from typing import Any, Iterator

import config
from agents.state import AgentState
from agents.nodes import (
    supervisor_node,
    memory_node,
    summarize_node,
    search_node,
    code_node,
    error_handler_node,
)

_log = logging.getLogger("orion.agents.graph")
_handler = logging.FileHandler(config.LOGS_DIR / "agents.log")
_handler.setFormatter(logging.Formatter("%(asctime)s  %(levelname)-8s  %(message)s"))
_log.addHandler(_handler)
_log.setLevel(getattr(logging, config.LOG_LEVEL, logging.INFO))


class OrionAgentGraph:
    """
    LangGraph-based agent graph for multi-step task execution.

    The graph defines the execution flow:
        start → supervisor → [memory, search, code] → summarize → end

    Example:
        graph = OrionAgentGraph()
        state = graph.run("Search for Python tutorials", {})
    """

    def __init__(self) -> None:
        """
        Initialize the agent graph.

        Example:
            graph = OrionAgentGraph()
        """
        self._graph = None
        self._app = None

    def build_graph(self):
        """
        Build the LangGraph StateGraph with all nodes and edges.

        Creates a graph with the following structure:
            START → supervisor → [memory | search | code] → summarize → END

        Returns:
            The compiled StateGraph application.

        Example:
            app = graph.build_graph()
        """
        try:
            from langgraph.graph import StateGraph, START, END

            builder = StateGraph(dict)

            builder.add_node("supervisor", self._wrap_node(supervisor_node))
            builder.add_node("memory", self._wrap_node(memory_node))
            builder.add_node("summarize", self._wrap_node(summarize_node))
            builder.add_node("error_handler", self._wrap_node(error_handler_node))

            builder.add_node("search", self._wrap_stub_node("search", search_node))
            builder.add_node("code", self._wrap_stub_node("code", code_node))

            builder.add_edge(START, "supervisor")

            builder.add_conditional_edges(
                "supervisor",
                self._route_after_supervisor,
                {
                    "memory": "memory",
                    "search": "search",
                    "code": "code",
                    "summarize": "summarize",
                },
            )

            builder.add_edge("memory", "summarize")
            builder.add_edge("search", "summarize")
            builder.add_edge("code", "summarize")
            builder.add_edge("summarize", END)
            builder.add_edge("error_handler", END)

            self._graph = builder.compile()
            _log.info("Agent graph built successfully")

            return self._graph

        except ImportError as exc:
            _log.warning("LangGraph not available, using simple executor: %s", exc)
            return None

    def _wrap_node(self, node_func):
        """
        Wrap a node function to handle errors gracefully.

        Args:
            node_func: The node function to wrap.

        Returns:
            Wrapped function that catches exceptions.
        """

        def wrapped(state: dict) -> dict:
            try:
                agent_state = AgentState(state)
                result = node_func(agent_state)
                return dict(result)
            except Exception as exc:
                _log.error("Node %s failed: %s", node_func.__name__, exc)
                state["status"] = "error"
                state["error"] = str(exc)
                state["current_step"] = "error"
                return state

        return wrapped

    def _wrap_stub_node(self, name: str, node_func):
        """
        Wrap a stub node that raises NotImplementedError.

        Args:
            name: Node name for logging.
            node_func: The stub function.

        Returns:
            Wrapped function that returns a stub result.
        """

        def wrapped(state: dict) -> dict:
            _log.info("Stub node '%s' called - returning placeholder", name)
            state.setdefault("results", []).append(
                {
                    "node": name,
                    "result": {
                        "status": "stub",
                        "message": f"{name} node not yet implemented",
                    },
                }
            )
            return state

        return wrapped

    def _route_after_supervisor(self, state: dict) -> str:
        """
        Determine which node to route to after supervisor.

        Args:
            state: Current graph state.

        Returns:
            Name of the next node.
        """
        results = state.get("results", [])
        for r in reversed(results):
            if r.get("node") == "supervisor":
                plan = r.get("result", {}).get("plan", [])
                if plan:
                    return plan[0]
        return "memory"

    def run(self, task: str, context: dict | None = None) -> dict:
        """
        Execute the agent graph for a given task.

        Args:
            task: The task description to execute.
            context: Optional additional context.

        Returns:
            The final agent state after execution.

        Example:
            result = graph.run("Search for Python tutorials")
        """
        _log.info("Running agent graph for task: %s", task[:100])

        initial_state = AgentState.create(
            task, context.get("messages", []) if context else []
        )

        app = self._graph or self.build_graph()

        if app is not None:
            try:
                result = app.invoke(dict(initial_state))
                _log.info("Agent graph completed with status: %s", result.get("status"))
                return result
            except Exception as exc:
                _log.error("Graph execution failed: %s", exc)
                return {
                    "task": task,
                    "status": "error",
                    "error": str(exc),
                    "results": [],
                }

        _log.info("Using fallback executor (no LangGraph)")
        return self._fallback_run(initial_state)

    def _fallback_run(self, state: AgentState) -> dict:
        """
        Fallback executor when LangGraph is not available.

        Runs nodes sequentially: supervisor → memory → summarize.

        Args:
            state: Initial agent state.

        Returns:
            Final state after execution.
        """
        try:
            state = supervisor_node(state)
            state = memory_node(state)
            state = summarize_node(state)
            return dict(state)
        except Exception as exc:
            _log.error("Fallback execution failed: %s", exc)
            return {
                "task": state.task,
                "status": "error",
                "error": str(exc),
                "results": state.results,
            }

    def stream_run(self, task: str, context: dict | None = None) -> Iterator[dict]:
        """
        Stream the agent graph execution, yielding state updates.

        Args:
            task: The task description to execute.
            context: Optional additional context.

        Yields:
            State dictionaries as each node completes.

        Example:
            for update in graph.stream_run("Analyze data"):
                print(update["current_step"])
        """
        _log.info("Streaming agent graph for task: %s", task[:100])

        initial_state = AgentState.create(
            task, context.get("messages", []) if context else []
        )

        app = self._graph or self.build_graph()

        if app is not None:
            try:
                for event in app.stream(dict(initial_state)):
                    for node_name, node_state in event.items():
                        yield {
                            "node": node_name,
                            "state": node_state,
                        }
                return
            except Exception as exc:
                _log.error("Stream execution failed: %s", exc)
                yield {
                    "node": "error",
                    "state": {
                        "status": "error",
                        "error": str(exc),
                    },
                }
                return

        try:
            state = AgentState.create(
                task, context.get("messages", []) if context else []
            )

            state = supervisor_node(state)
            yield {"node": "supervisor", "state": dict(state)}

            state = memory_node(state)
            yield {"node": "memory", "state": dict(state)}

            state = summarize_node(state)
            yield {"node": "summarize", "state": dict(state)}

        except Exception as exc:
            _log.error("Fallback stream failed: %s", exc)
            yield {
                "node": "error",
                "state": {
                    "status": "error",
                    "error": str(exc),
                },
            }
