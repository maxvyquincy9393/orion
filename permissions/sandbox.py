"""
sandbox.py

Core permission engine for Orion.
Every action Orion takes must pass through check() before execution.
If confirmation is required, request_confirm() sends a Telegram message
and waits for the user to reply "yes" or "no" within 30 seconds.
All checks and results are logged to logs/permissions.log.
Part of Orion — Persistent AI Companion System.
"""

import logging
import time
from datetime import datetime
from pathlib import Path
from typing import Any

import requests

import config
from permissions.permission_types import (
    ACTION_TO_SECTION,
    PermissionAction,
    PermissionResult,
)
from permissions import config_loader

# ---------------------------------------------------------------------------
# Logger setup — writes to logs/permissions.log
# ---------------------------------------------------------------------------
_LOG_DIR = Path(__file__).resolve().parent.parent / "logs"
_LOG_DIR.mkdir(exist_ok=True)
_LOG_FILE = _LOG_DIR / "permissions.log"

_logger = logging.getLogger("orion.permissions")
_logger.setLevel(logging.DEBUG)

if not _logger.handlers:
    _file_handler = logging.FileHandler(_LOG_FILE, encoding="utf-8")
    _file_handler.setLevel(logging.DEBUG)
    _formatter = logging.Formatter(
        "%(asctime)s | %(levelname)-8s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    _file_handler.setFormatter(_formatter)
    _logger.addHandler(_file_handler)

# ---------------------------------------------------------------------------
# Module state — config is loaded lazily on first check()
# ---------------------------------------------------------------------------
_initialized: bool = False


def _ensure_loaded() -> None:
    """Load the permissions config if not already loaded."""
    global _initialized
    if not _initialized:
        config_loader.load(config.PERMISSIONS_YAML_PATH)
        _initialized = True


# ===========================================================================
# Core API
# ===========================================================================


def check(action: str, details: dict[str, Any] | None = None) -> PermissionResult:
    """
    Check whether an action is allowed by the current permission configuration.

    This is the gateway — every system action must call this first.

    Args:
        action: The action string (e.g. "file.write", "terminal.run").
                Must match a PermissionAction.value.
        details: Optional context dict with specifics about the action.
                 For file ops: {"path": "..."}.
                 For terminal: {"command": "..."}.
                 For browser: {"url": "..."} or {"query": "..."}.
                 For app: {"app": "..."}.

    Returns:
        A PermissionResult indicating allowed, requires_confirm, and reason.

    Example:
        result = check("file.write", {"path": "/home/user/doc.txt"})
        if not result.allowed:
            print(f"Blocked: {result.reason}")
        if result.requires_confirm:
            confirmed = request_confirm("file.write", {"path": "/home/user/doc.txt"})
    """
    if details is None:
        details = {}

    _ensure_loaded()

    # Validate the action string
    valid_actions = {a.value for a in PermissionAction}
    if action not in valid_actions:
        result = PermissionResult(
            allowed=False,
            requires_confirm=False,
            reason=f"Unknown action '{action}'. Valid actions: {sorted(valid_actions)}",
            action=action,
        )
        _log_check(action, details, result)
        return result

    # Look up the config section for this action
    section_key = ACTION_TO_SECTION.get(action)
    if section_key is None:
        result = PermissionResult(
            allowed=False,
            requires_confirm=False,
            reason=f"No config section mapped for action '{action}'.",
            action=action,
        )
        _log_check(action, details, result)
        return result

    try:
        section = config_loader.get(section_key)
    except KeyError:
        result = PermissionResult(
            allowed=False,
            requires_confirm=False,
            reason=f"Permission section '{section_key}' not found in config.",
            action=action,
        )
        _log_check(action, details, result)
        return result

    # --- Global enable check ---
    if not section.get("enabled", False):
        result = PermissionResult(
            allowed=False,
            requires_confirm=False,
            reason=f"Section '{section_key}' is disabled in permissions.yaml.",
            action=action,
        )
        _log_check(action, details, result)
        return result

    # --- Per-action fine-grained checks ---
    result = _check_action_specific(action, section_key, section, details)
    _log_check(action, details, result)
    return result


def request_confirm(action: str, details: dict[str, Any] | None = None, timeout: int = 30) -> bool:
    """
    Send a confirmation request to the user via Telegram and wait for reply.

    Sends a message describing the action and waits up to `timeout` seconds
    for the user to reply "yes" or "no".

    Args:
        action: The action string (e.g. "file.write").
        details: Context dict with action specifics.
        timeout: Maximum seconds to wait for user reply. Defaults to 30.

    Returns:
        True if user replied "yes", False if "no" or timeout.

    Example:
        confirmed = request_confirm("terminal.run", {"command": "pip install flask"})
    """
    if details is None:
        details = {}

    detail_str = ", ".join(f"{k}={v}" for k, v in details.items()) if details else "no details"
    message = (
        f"🔒 *Orion Permission Request*\n\n"
        f"Action: `{action}`\n"
        f"Details: {detail_str}\n\n"
        f"Reply *yes* to allow or *no* to deny.\n"
        f"(Auto-deny in {timeout}s)"
    )

    _logger.info(f"CONFIRM REQUEST | {action} | {detail_str} | timeout={timeout}s")

    # --- Send via Telegram Bot API ---
    bot_token = config.TELEGRAM_BOT_TOKEN
    user_id = config.DEFAULT_USER_ID

    if not bot_token:
        _logger.warning("CONFIRM DENIED | No TELEGRAM_BOT_TOKEN configured — auto-denying.")
        return False

    send_url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    try:
        resp = requests.post(
            send_url,
            json={
                "chat_id": user_id,
                "text": message,
                "parse_mode": "Markdown",
            },
            timeout=10,
        )
        resp.raise_for_status()
        _logger.info(f"CONFIRM SENT | Telegram message sent to {user_id}")
    except requests.RequestException as e:
        _logger.error(f"CONFIRM SEND FAILED | {e}")
        return False

    # --- Poll for reply ---
    # Get the update_id offset: only read updates that arrive AFTER our message
    last_update_id = _get_latest_update_id(bot_token)
    deadline = time.time() + timeout

    while time.time() < deadline:
        try:
            updates_url = f"https://api.telegram.org/bot{bot_token}/getUpdates"
            params: dict[str, Any] = {"timeout": 5}
            if last_update_id is not None:
                params["offset"] = last_update_id + 1

            resp = requests.get(updates_url, params=params, timeout=10)
            resp.raise_for_status()
            data = resp.json()

            for update in data.get("result", []):
                last_update_id = update.get("update_id", last_update_id)
                msg = update.get("message", {})
                text = (msg.get("text") or "").strip().lower()
                chat_id = str(msg.get("chat", {}).get("id", ""))

                if chat_id == str(user_id) and text in ("yes", "no"):
                    confirmed = text == "yes"
                    status = "APPROVED" if confirmed else "DENIED"
                    _logger.info(f"CONFIRM {status} | {action} | user replied '{text}'")

                    # Acknowledge confirmation offset so it's not re-read
                    _acknowledge_update(bot_token, last_update_id)
                    return confirmed

        except requests.RequestException as e:
            _logger.warning(f"CONFIRM POLL ERROR | {e}")
            time.sleep(2)
            continue

        time.sleep(1)

    _logger.warning(f"CONFIRM TIMEOUT | {action} | No reply within {timeout}s — auto-denying.")
    return False


def get_config() -> dict[str, Any]:
    """
    Return the current full permissions configuration.

    Returns:
        The complete permissions dict from permissions.yaml.

    Example:
        cfg = get_config()
    """
    _ensure_loaded()
    return config_loader.get_all()


def reload_config() -> None:
    """
    Hot-reload permissions.yaml from disk without restarting.

    Example:
        reload_config()  # pick up changes to permissions.yaml
    """
    config_loader.reload()
    _logger.info("CONFIG RELOADED | permissions.yaml re-read from disk")


# ===========================================================================
# Internal: action-specific permission logic
# ===========================================================================


def _check_action_specific(
    action: str,
    section_key: str,
    section: dict[str, Any],
    details: dict[str, Any],
) -> PermissionResult:
    """
    Run fine-grained checks specific to each action type.

    Args:
        action: The action string.
        section_key: The permissions.yaml section name.
        section: The section dict from config.
        details: Action-specific details.

    Returns:
        A PermissionResult.
    """

    # ---- File System ----
    if section_key == "file_system":
        return _check_file_system(action, section, details)

    # ---- Terminal ----
    if section_key == "terminal":
        return _check_terminal(action, section, details)

    # ---- App Control ----
    if section_key == "app_control":
        return _check_app_control(action, section, details)

    # ---- Input Control ----
    if section_key == "input_control":
        return _check_simple_with_confirm(action, section, "input_control")

    # ---- Calendar ----
    if section_key == "calendar":
        return _check_calendar(action, section)

    # ---- Browsing ----
    if section_key == "browsing":
        return _check_browsing(action, section, details)

    # ---- Search ----
    if section_key == "search":
        # Search is simple — if enabled, it's allowed.
        return PermissionResult(
            allowed=True,
            requires_confirm=False,
            reason="Search is enabled.",
            action=action,
        )

    # ---- System Info ----
    if section_key == "system_info":
        return PermissionResult(
            allowed=True,
            requires_confirm=False,
            reason="System info read is enabled.",
            action=action,
        )

    # Fallback: deny unknown
    return PermissionResult(
        allowed=False,
        requires_confirm=False,
        reason=f"No specific handler for section '{section_key}'.",
        action=action,
    )


def _check_file_system(
    action: str, section: dict[str, Any], details: dict[str, Any]
) -> PermissionResult:
    """Check file system permissions (read/write/delete + path filtering)."""

    # Sub-action checks
    if action == PermissionAction.FILE_READ.value and not section.get("read", False):
        return PermissionResult(False, False, "File read is disabled.", action)

    if action == PermissionAction.FILE_WRITE.value and not section.get("write", False):
        return PermissionResult(False, False, "File write is disabled.", action)

    if action == PermissionAction.FILE_DELETE.value and not section.get("delete", False):
        return PermissionResult(False, False, "File delete is disabled.", action)

    # Path filtering
    target_path = details.get("path", "")
    if target_path:
        blocked = section.get("blocked_paths", []) or []
        for blocked_path in blocked:
            expanded = str(Path(blocked_path).expanduser())
            if target_path.startswith(expanded):
                return PermissionResult(
                    False, False, f"Path '{target_path}' is in blocked_paths.", action
                )

        allowed = section.get("allowed_paths", []) or []
        if allowed:
            path_ok = False
            for allowed_path in allowed:
                expanded = str(Path(allowed_path).expanduser())
                if target_path.startswith(expanded):
                    path_ok = True
                    break
            if not path_ok:
                return PermissionResult(
                    False, False, f"Path '{target_path}' is not in allowed_paths.", action
                )

    requires_confirm = section.get("require_confirm", False)
    return PermissionResult(
        allowed=True,
        requires_confirm=requires_confirm,
        reason="File operation allowed." + (" Confirmation required." if requires_confirm else ""),
        action=action,
    )


def _check_terminal(
    action: str, section: dict[str, Any], details: dict[str, Any]
) -> PermissionResult:
    """Check terminal command permissions + blocked command filtering."""
    command = details.get("command", "")
    blocked = section.get("blocked_commands", []) or []

    for blocked_cmd in blocked:
        if blocked_cmd in command:
            return PermissionResult(
                False, False, f"Command contains blocked pattern '{blocked_cmd}'.", action
            )

    requires_confirm = section.get("require_confirm", False)
    return PermissionResult(
        allowed=True,
        requires_confirm=requires_confirm,
        reason="Terminal command allowed." + (" Confirmation required." if requires_confirm else ""),
        action=action,
    )


def _check_app_control(
    action: str, section: dict[str, Any], details: dict[str, Any]
) -> PermissionResult:
    """Check app control permissions + allowed app filtering."""
    app_name = details.get("app", "").lower()
    allowed_apps = [a.lower() for a in (section.get("allowed_apps", []) or [])]

    if allowed_apps and app_name and app_name not in allowed_apps:
        return PermissionResult(
            False, False, f"App '{app_name}' is not in allowed_apps: {allowed_apps}.", action
        )

    requires_confirm = section.get("require_confirm", False)
    return PermissionResult(
        allowed=True,
        requires_confirm=requires_confirm,
        reason="App control allowed." + (" Confirmation required." if requires_confirm else ""),
        action=action,
    )


def _check_simple_with_confirm(
    action: str, section: dict[str, Any], label: str
) -> PermissionResult:
    """Generic check for sections that only have enabled + require_confirm."""
    requires_confirm = section.get("require_confirm", False)
    return PermissionResult(
        allowed=True,
        requires_confirm=requires_confirm,
        reason=f"{label} allowed." + (" Confirmation required." if requires_confirm else ""),
        action=action,
    )


def _check_calendar(action: str, section: dict[str, Any]) -> PermissionResult:
    """Check calendar permissions (read vs write)."""
    if action == PermissionAction.CALENDAR_READ.value and not section.get("read", False):
        return PermissionResult(False, False, "Calendar read is disabled.", action)

    if action == PermissionAction.CALENDAR_WRITE.value and not section.get("write", False):
        return PermissionResult(False, False, "Calendar write is disabled.", action)

    requires_confirm = section.get("require_confirm", False)
    return PermissionResult(
        allowed=True,
        requires_confirm=requires_confirm,
        reason="Calendar access allowed." + (" Confirmation required." if requires_confirm else ""),
        action=action,
    )


def _check_browsing(
    action: str, section: dict[str, Any], details: dict[str, Any]
) -> PermissionResult:
    """Check browsing permissions + domain filtering."""
    url = details.get("url", "")

    if url:
        blocked_domains = section.get("blocked_domains", []) or []
        for domain in blocked_domains:
            if domain in url:
                return PermissionResult(
                    False, False, f"Domain '{domain}' is blocked.", action
                )

        allowed_domains = section.get("allowed_domains", []) or []
        if allowed_domains:
            domain_ok = any(d in url for d in allowed_domains)
            if not domain_ok:
                return PermissionResult(
                    False, False, f"URL '{url}' not in allowed_domains.", action
                )

    requires_confirm = section.get("require_confirm", False)
    return PermissionResult(
        allowed=True,
        requires_confirm=requires_confirm,
        reason="Browsing allowed." + (" Confirmation required." if requires_confirm else ""),
        action=action,
    )


# ===========================================================================
# Internal: Telegram helpers
# ===========================================================================


def _get_latest_update_id(bot_token: str) -> int | None:
    """
    Get the latest Telegram update_id so we only poll for NEW messages.

    Args:
        bot_token: Telegram bot API token.

    Returns:
        The latest update_id, or None if no updates exist.
    """
    try:
        resp = requests.get(
            f"https://api.telegram.org/bot{bot_token}/getUpdates",
            params={"limit": 1, "offset": -1},
            timeout=5,
        )
        resp.raise_for_status()
        results = resp.json().get("result", [])
        if results:
            return results[-1].get("update_id")
    except requests.RequestException:
        pass
    return None


def _acknowledge_update(bot_token: str, update_id: int) -> None:
    """
    Acknowledge a Telegram update so it's not returned again.

    Args:
        bot_token: Telegram bot API token.
        update_id: The update_id to acknowledge.
    """
    try:
        requests.get(
            f"https://api.telegram.org/bot{bot_token}/getUpdates",
            params={"offset": update_id + 1},
            timeout=5,
        )
    except requests.RequestException:
        pass


# ===========================================================================
# Internal: Logging
# ===========================================================================


def _log_check(action: str, details: dict[str, Any], result: PermissionResult) -> None:
    """
    Log every permission check and its result.

    Args:
        action: The action that was checked.
        details: The action details dict.
        result: The PermissionResult.
    """
    detail_str = ", ".join(f"{k}={v}" for k, v in details.items()) if details else "(none)"
    status = "ALLOWED" if result.allowed else "DENIED"
    confirm = " [CONFIRM_REQUIRED]" if result.requires_confirm else ""

    _logger.info(
        f"CHECK {status}{confirm} | {action} | details: {detail_str} | reason: {result.reason}"
    )
