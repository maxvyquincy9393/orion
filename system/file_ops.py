"""
file_ops.py

File system operations for Orion.
All operations pass through sandbox permission check first.
Part of Orion — Persistent AI Companion System.
"""

import logging
import os
from pathlib import Path
from typing import Optional

import config

_log = logging.getLogger("orion.system")
_log_file = config.LOGS_DIR / "system.log"
_handler = logging.FileHandler(_log_file)
_handler.setFormatter(logging.Formatter("%(asctime)s | %(levelname)-8s | %(message)s"))
_log.addHandler(_handler)
_log.setLevel(getattr(logging, config.LOG_LEVEL, logging.INFO))


def _check_permission(action: str, path: str) -> tuple[bool, str]:
    """
    Check sandbox permission for file operation.

    Args:
        action: The permission action.
        path: The file path.

    Returns:
        Tuple of (allowed, reason).
    """
    try:
        from permissions.permission_types import PermissionAction
        from permissions import sandbox

        result = sandbox.check(action, {"path": path})

        if not result.allowed:
            return False, result.reason

        if result.requires_confirm:
            confirmed = sandbox.request_confirm(action, {"path": path})
            if not confirmed:
                return False, "User declined"

        return True, "Allowed"

    except Exception as exc:
        _log.error("Permission check failed: %s", exc)
        return True, "Permission check error - allowing"


def read_file(path: str) -> str:
    """
    Read a file and return its contents.

    Checks FILE_READ permission first.

    Args:
        path: The file path to read.

    Returns:
        The file contents as string, or error message.

    Example:
        content = read_file("~/Documents/notes.txt")
    """
    expanded_path = str(Path(path).expanduser().resolve())

    allowed, reason = _check_permission("file.read", expanded_path)
    if not allowed:
        _log.warning("FILE READ BLOCKED | path=%s | reason=%s", expanded_path, reason)
        return f"[Permission denied: {reason}]"

    try:
        with open(expanded_path, "r", encoding="utf-8") as f:
            content = f.read()

        _log.info("FILE READ | path=%s | len=%d", expanded_path, len(content))
        return content

    except FileNotFoundError:
        _log.error("FILE READ | file not found: %s", expanded_path)
        return f"[Error] File not found: {expanded_path}"
    except PermissionError:
        _log.error("FILE READ | permission error: %s", expanded_path)
        return f"[Error] Permission denied: {expanded_path}"
    except Exception as exc:
        _log.error("FILE READ | error: %s | %s", expanded_path, exc)
        return f"[Error] Failed to read file: {exc}"


def write_file(path: str, content: str) -> bool:
    """
    Write content to a file.

    Checks FILE_WRITE permission first.

    Args:
        path: The file path to write.
        content: The content to write.

    Returns:
        True on success, False on failure.

    Example:
        success = write_file("~/Documents/notes.txt", "Hello world")
    """
    expanded_path = str(Path(path).expanduser().resolve())

    allowed, reason = _check_permission("file.write", expanded_path)
    if not allowed:
        _log.warning("FILE WRITE BLOCKED | path=%s | reason=%s", expanded_path, reason)
        return False

    try:
        Path(expanded_path).parent.mkdir(parents=True, exist_ok=True)

        with open(expanded_path, "w", encoding="utf-8") as f:
            f.write(content)

        _log.info("FILE WRITE | path=%s | len=%d", expanded_path, len(content))
        return True

    except PermissionError:
        _log.error("FILE WRITE | permission error: %s", expanded_path)
        return False
    except Exception as exc:
        _log.error("FILE WRITE | error: %s | %s", expanded_path, exc)
        return False


def delete_file(path: str) -> bool:
    """
    Delete a file.

    Checks FILE_DELETE permission first.

    Args:
        path: The file path to delete.

    Returns:
        True on success, False on failure.

    Example:
        success = delete_file("~/Documents/old.txt")
    """
    expanded_path = str(Path(path).expanduser().resolve())

    allowed, reason = _check_permission("file.delete", expanded_path)
    if not allowed:
        _log.warning("FILE DELETE BLOCKED | path=%s | reason=%s", expanded_path, reason)
        return False

    try:
        Path(expanded_path).unlink()
        _log.info("FILE DELETE | path=%s", expanded_path)
        return True

    except FileNotFoundError:
        _log.error("FILE DELETE | file not found: %s", expanded_path)
        return False
    except PermissionError:
        _log.error("FILE DELETE | permission error: %s", expanded_path)
        return False
    except Exception as exc:
        _log.error("FILE DELETE | error: %s | %s", expanded_path, exc)
        return False


def list_dir(path: str) -> list[str]:
    """
    List contents of a directory.

    Checks FILE_READ permission first.

    Args:
        path: The directory path.

    Returns:
        List of file/directory names, or empty list on error.

    Example:
        files = list_dir("~/Documents")
    """
    expanded_path = Path(path).expanduser().resolve()

    allowed, reason = _check_permission("file.read", str(expanded_path))
    if not allowed:
        _log.warning("DIR LIST BLOCKED | path=%s | reason=%s", expanded_path, reason)
        return []

    try:
        items = [item.name for item in expanded_path.iterdir()]
        _log.info("DIR LIST | path=%s | count=%d", expanded_path, len(items))
        return items

    except FileNotFoundError:
        _log.error("DIR LIST | directory not found: %s", expanded_path)
        return []
    except PermissionError:
        _log.error("DIR LIST | permission error: %s", expanded_path)
        return []
    except Exception as exc:
        _log.error("DIR LIST | error: %s | %s", expanded_path, exc)
        return []


def file_exists(path: str) -> bool:
    """
    Check if a file exists.

    Args:
        path: The file path.

    Returns:
        True if file exists, False otherwise.

    Example:
        if file_exists("~/Documents/notes.txt"):
            print("Found it")
    """
    expanded_path = Path(path).expanduser().resolve()
    return expanded_path.exists()


def get_file_info(path: str) -> dict:
    """
    Get file information.

    Args:
        path: The file path.

    Returns:
        Dict with file info, or error message.

    Example:
        info = get_file_info("~/Documents/notes.txt")
    """
    expanded_path = Path(path).expanduser().resolve()

    allowed, reason = _check_permission("file.read", str(expanded_path))
    if not allowed:
        return {"error": f"Permission denied: {reason}"}

    try:
        stat = expanded_path.stat()
        return {
            "path": str(expanded_path),
            "exists": True,
            "size": stat.st_size,
            "modified": stat.st_mtime,
            "is_file": expanded_path.is_file(),
            "is_dir": expanded_path.is_dir(),
        }
    except FileNotFoundError:
        return {"path": str(expanded_path), "exists": False, "error": "File not found"}
    except Exception as exc:
        return {"path": str(expanded_path), "exists": False, "error": str(exc)}


def create_dir(path: str) -> bool:
    """
    Create a directory.

    Checks FILE_WRITE permission first.

    Args:
        path: The directory path.

    Returns:
        True on success, False on failure.

    Example:
        success = create_dir("~/Documents/new_folder")
    """
    expanded_path = Path(path).expanduser().resolve()

    allowed, reason = _check_permission("file.write", str(expanded_path))
    if not allowed:
        _log.warning("DIR CREATE BLOCKED | path=%s | reason=%s", expanded_path, reason)
        return False

    try:
        expanded_path.mkdir(parents=True, exist_ok=True)
        _log.info("DIR CREATE | path=%s", expanded_path)
        return True
    except Exception as exc:
        _log.error("DIR CREATE | error: %s | %s", expanded_path, exc)
        return False


def copy_file(src: str, dst: str) -> bool:
    """
    Copy a file.

    Checks FILE_READ on source, FILE_WRITE on destination.

    Args:
        src: Source file path.
        dst: Destination file path.

    Returns:
        True on success, False on failure.

    Example:
        success = copy_file("~/Documents/a.txt", "~/Documents/b.txt")
    """
    import shutil

    expanded_src = Path(src).expanduser().resolve()
    expanded_dst = Path(dst).expanduser().resolve()

    allowed_src, reason_src = _check_permission("file.read", str(expanded_src))
    if not allowed_src:
        _log.warning("FILE COPY BLOCKED | src=%s | reason=%s", expanded_src, reason_src)
        return False

    allowed_dst, reason_dst = _check_permission("file.write", str(expanded_dst))
    if not allowed_dst:
        _log.warning("FILE COPY BLOCKED | dst=%s | reason=%s", expanded_dst, reason_dst)
        return False

    try:
        expanded_dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(expanded_src, expanded_dst)
        _log.info("FILE COPY | src=%s | dst=%s", expanded_src, expanded_dst)
        return True
    except Exception as exc:
        _log.error("FILE COPY | error: %s -> %s | %s", expanded_src, expanded_dst, exc)
        return False
