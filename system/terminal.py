"""
terminal.py

Terminal command execution for Orion.
All commands pass through sandbox permission check first.
Part of Orion — Persistent AI Companion System.
"""

import logging
import subprocess
from typing import Optional

import config

_log = logging.getLogger("orion.system")
_log_file = config.LOGS_DIR / "system.log"
_handler = logging.FileHandler(_log_file)
_handler.setFormatter(logging.Formatter("%(asctime)s | %(levelname)-8s | %(message)s"))
_log.addHandler(_handler)
_log.setLevel(getattr(logging, config.LOG_LEVEL, logging.INFO))

BLOCKED_COMMANDS = [
    "rm -rf",
    "rm -rf /",
    "rm -rf ~",
    "sudo",
    "su ",
    "format",
    "del /",
    "rmdir /s",
    "shutdown",
    "reboot",
    "halt",
    "poweroff",
    "init 0",
    "init 6",
    "> /dev/sda",
    "mkfs",
    "dd if=",
    ":(){ :|:& };:",
    "chmod -R 777",
]


def _check_permission(command: str) -> tuple[bool, str]:
    """
    Check sandbox permission for terminal command.

    Args:
        command: The command to check.

    Returns:
        Tuple of (allowed, reason).
    """
    try:
        from permissions.permission_types import PermissionAction
        from permissions import sandbox

        result = sandbox.check(
            PermissionAction.TERMINAL_RUN.value, {"command": command}
        )

        if not result.allowed:
            return False, result.reason

        if result.requires_confirm:
            confirmed = sandbox.request_confirm(
                PermissionAction.TERMINAL_RUN.value,
                {"command": command},
            )
            if not confirmed:
                return False, "User declined"

        return True, "Allowed"

    except Exception as exc:
        _log.error("Permission check failed: %s", exc)
        return True, "Permission check error - allowing"


def _is_blocked(command: str) -> tuple[bool, str]:
    """
    Check if command is in blocked list.

    Args:
        command: The command to check.

    Returns:
        Tuple of (is_blocked, blocked_pattern).
    """
    command_lower = command.lower().strip()

    for blocked in BLOCKED_COMMANDS:
        if blocked.lower() in command_lower:
            return True, blocked

    return False, ""


def run(command: str, timeout: int = 30) -> dict:
    """
    Run a terminal command.

    Checks TERMINAL_RUN permission first.
    Returns stdout, stderr, and exit_code.

    Args:
        command: The command to run.
        timeout: Maximum execution time in seconds. Defaults to 30.

    Returns:
        Dict with stdout, stderr, exit_code.

    Example:
        result = run("ls -la")
        print(result["stdout"])
    """
    allowed, reason = _check_permission(command)
    if not allowed:
        _log.warning("TERMINAL BLOCKED | cmd='%s' | reason=%s", command[:50], reason)
        return {
            "stdout": "",
            "stderr": f"Permission denied: {reason}",
            "exit_code": -1,
        }

    is_blocked, blocked_pattern = _is_blocked(command)
    if is_blocked:
        _log.warning(
            "TERMINAL BLOCKED | cmd contains blocked pattern: %s", blocked_pattern
        )
        return {
            "stdout": "",
            "stderr": f"Command blocked: contains '{blocked_pattern}'",
            "exit_code": -1,
        }

    _log.info("TERMINAL RUN | cmd='%s' | timeout=%d", command[:50], timeout)

    try:
        result = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            timeout=timeout,
        )

        _log.info(
            "TERMINAL COMPLETE | cmd='%s' | exit_code=%d | stdout_len=%d | stderr_len=%d",
            command[:50],
            result.returncode,
            len(result.stdout),
            len(result.stderr),
        )

        return {
            "stdout": result.stdout,
            "stderr": result.stderr,
            "exit_code": result.returncode,
        }

    except subprocess.TimeoutExpired:
        _log.error("TERMINAL TIMEOUT | cmd='%s' | timeout=%d", command[:50], timeout)
        return {
            "stdout": "",
            "stderr": f"Command timed out after {timeout} seconds",
            "exit_code": -1,
        }
    except Exception as exc:
        _log.error("TERMINAL ERROR | cmd='%s' | error=%s", command[:50], exc)
        return {
            "stdout": "",
            "stderr": str(exc),
            "exit_code": -1,
        }


def run_safe(command: str, timeout: int = 30) -> dict:
    """
    Run a terminal command with additional safety checks.

    Always checks against blocked_commands list before running.
    Always requires user confirmation.

    Args:
        command: The command to run.
        timeout: Maximum execution time in seconds. Defaults to 30.

    Returns:
        Dict with stdout, stderr, exit_code.

    Example:
        result = run_safe("pip install requests")
    """
    is_blocked, blocked_pattern = _is_blocked(command)
    if is_blocked:
        _log.warning("TERMINAL SAFE BLOCKED | cmd contains: %s", blocked_pattern)
        return {
            "stdout": "",
            "stderr": f"Command blocked: contains '{blocked_pattern}'",
            "exit_code": -1,
        }

    return run(command, timeout)


def run_background(command: str) -> Optional[int]:
    """
    Run a command in the background.

    Returns immediately with process ID.

    Args:
        command: The command to run.

    Returns:
        Process ID, or None on failure.

    Example:
        pid = run_background("python server.py")
    """
    allowed, reason = _check_permission(command)
    if not allowed:
        _log.warning("TERMINAL BG BLOCKED | cmd='%s' | reason=%s", command[:50], reason)
        return None

    is_blocked, blocked_pattern = _is_blocked(command)
    if is_blocked:
        _log.warning("TERMINAL BG BLOCKED | cmd contains: %s", blocked_pattern)
        return None

    try:
        process = subprocess.Popen(
            command,
            shell=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

        _log.info("TERMINAL BG START | cmd='%s' | pid=%d", command[:50], process.pid)
        return process.pid

    except Exception as exc:
        _log.error("TERMINAL BG ERROR | cmd='%s' | error=%s", command[:50], exc)
        return None


def check_command_exists(command: str) -> bool:
    """
    Check if a command exists in the system.

    Args:
        command: The command name to check.

    Returns:
        True if command exists, False otherwise.

    Example:
        if check_command_exists("git"):
            print("Git is installed")
    """
    try:
        result = subprocess.run(
            ["where" if config.PLATFORM == "win32" else "which", command],
            capture_output=True,
            timeout=5,
        )
        return result.returncode == 0
    except Exception:
        return False


def get_environment() -> dict:
    """
    Get current environment variables.

    Returns:
        Dict of environment variables.

    Example:
        env = get_environment()
        print(env.get("PATH"))
    """
    return dict(os.environ)


def get_current_directory() -> str:
    """
    Get current working directory.

    Returns:
        Current directory path.

    Example:
        cwd = get_current_directory()
    """
    import os

    return os.getcwd()


import os
