"""
permission_types.py

Defines the PermissionAction enum with all possible actions Orion can take,
and the PermissionResult dataclass returned by every permission check.
Part of Orion — Persistent AI Companion System.
"""

from dataclasses import dataclass
from enum import Enum, unique


@unique
class PermissionAction(Enum):
    """
    Enum of every possible action Orion can perform.
    Every system action must map to one of these before going through
    the permission sandbox.

    Usage:
        action = PermissionAction.FILE_READ
        result = sandbox.check(action.value, details)
    """

    # --- File System ---
    FILE_READ = "file.read"
    FILE_WRITE = "file.write"
    FILE_DELETE = "file.delete"

    # --- Terminal ---
    TERMINAL_RUN = "terminal.run"

    # --- Applications ---
    APP_OPEN = "app.open"

    # --- Input Control (mouse / keyboard) ---
    INPUT_CONTROL = "input.control"

    # --- Calendar ---
    CALENDAR_READ = "calendar.read"
    CALENDAR_WRITE = "calendar.write"

    # --- Browser ---
    BROWSER_NAVIGATE = "browser.navigate"
    BROWSER_SEARCH = "browser.search"

    # --- System Info ---
    SYSTEM_INFO = "system.info"


# ---------------------------------------------------------------------------
# Mapping from PermissionAction.value → permissions.yaml section key
# Used by the sandbox to look up the correct config section.
# ---------------------------------------------------------------------------
ACTION_TO_SECTION: dict[str, str] = {
    PermissionAction.FILE_READ.value: "file_system",
    PermissionAction.FILE_WRITE.value: "file_system",
    PermissionAction.FILE_DELETE.value: "file_system",
    PermissionAction.TERMINAL_RUN.value: "terminal",
    PermissionAction.APP_OPEN.value: "app_control",
    PermissionAction.INPUT_CONTROL.value: "input_control",
    PermissionAction.CALENDAR_READ.value: "calendar",
    PermissionAction.CALENDAR_WRITE.value: "calendar",
    PermissionAction.BROWSER_NAVIGATE.value: "browsing",
    PermissionAction.BROWSER_SEARCH.value: "search",
    PermissionAction.SYSTEM_INFO.value: "system_info",
}


@dataclass(frozen=True)
class PermissionResult:
    """
    Result of a permission check from the sandbox.

    Attributes:
        allowed: True if the action is permitted.
        requires_confirm: True if the user must explicitly approve before execution.
        reason: Human-readable explanation of why the action was allowed or denied.
        action: The action string that was checked (e.g. "file.write").

    Example:
        result = PermissionResult(
            allowed=True,
            requires_confirm=True,
            reason="File write requires user confirmation",
            action="file.write",
        )
        if not result.allowed:
            print(f"Blocked: {result.reason}")
    """

    allowed: bool
    requires_confirm: bool
    reason: str
    action: str

    def __str__(self) -> str:
        status = "ALLOWED" if self.allowed else "DENIED"
        confirm = " (confirm required)" if self.requires_confirm else ""
        return f"[{status}{confirm}] {self.action}: {self.reason}"
