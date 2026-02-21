"""
state.py

Agent state schema for LangGraph agent system.
Defines the TypedDict that flows through all agent nodes.
Part of Orion — Persistent AI Companion System.
"""

from typing import Any


class AgentState(dict):
    """
    State schema for LangGraph agent execution.

    This TypedDict flows through all agent nodes during task execution.
    Each node reads from and writes to this state.

    Attributes:
        task: The original task description from the user.
        context: List of context messages (role, content) for the task.
        memory: List of relevant memories retrieved for this task.
        current_step: Name of the current node being executed.
        results: Accumulated results from each completed step.
        permissions_checked: Whether permission checks have been performed.
        status: Current execution status.
            - "running": Task is actively being processed
            - "waiting_confirm": Waiting for user confirmation
            - "complete": Task finished successfully
            - "error": Task encountered an error
        error: Error message if status is "error", else None.

    Example:
        state = AgentState(
            task="Search for Python tutorials",
            context=[],
            memory=[],
            current_step="start",
            results=[],
            permissions_checked=False,
            status="running",
            error=None,
        )
    """

    @classmethod
    def create(cls, task: str, context: list[dict] | None = None) -> "AgentState":
        """
        Create a new AgentState with default values.

        Args:
            task: The task description.
            context: Optional initial context messages.

        Returns:
            A new AgentState instance ready for execution.

        Example:
            state = AgentState.create("Analyze the log files")
        """
        return cls(
            task=task,
            context=context or [],
            memory=[],
            current_step="start",
            results=[],
            permissions_checked=False,
            status="running",
            error=None,
        )

    @property
    def task(self) -> str:
        return self.get("task", "")

    @task.setter
    def task(self, value: str) -> None:
        self["task"] = value

    @property
    def context(self) -> list[dict]:
        return self.get("context", [])

    @context.setter
    def context(self, value: list[dict]) -> None:
        self["context"] = value

    @property
    def memory(self) -> list[dict]:
        return self.get("memory", [])

    @memory.setter
    def memory(self, value: list[dict]) -> None:
        self["memory"] = value

    @property
    def current_step(self) -> str:
        return self.get("current_step", "start")

    @current_step.setter
    def current_step(self, value: str) -> None:
        self["current_step"] = value

    @property
    def results(self) -> list[dict]:
        return self.get("results", [])

    @results.setter
    def results(self, value: list[dict]) -> None:
        self["results"] = value

    @property
    def permissions_checked(self) -> bool:
        return self.get("permissions_checked", False)

    @permissions_checked.setter
    def permissions_checked(self, value: bool) -> None:
        self["permissions_checked"] = value

    @property
    def status(self) -> str:
        return self.get("status", "running")

    @status.setter
    def status(self, value: str) -> None:
        self["status"] = value

    @property
    def error(self) -> str | None:
        return self.get("error")

    @error.setter
    def error(self, value: str | None) -> None:
        self["error"] = value

    def add_result(self, node_name: str, result: Any) -> None:
        """
        Add a result from a completed node.

        Args:
            node_name: Name of the node that produced the result.
            result: The result value.

        Example:
            state.add_result("memory_node", {"facts": ["..."]})
        """
        self["results"].append(
            {
                "node": node_name,
                "result": result,
            }
        )

    def set_error(self, error_message: str) -> None:
        """
        Set the error state with a message.

        Args:
            error_message: Description of the error.

        Example:
            state.set_error("Failed to connect to database")
        """
        self["status"] = "error"
        self["error"] = error_message
