"""
autopush.py

Auto git commit and push on file change.
Watches the project directory for changes and automatically
commits and pushes to origin/main.
Part of Orion — Persistent AI Companion System.

Usage:
    python scripts/autopush.py
"""

import logging
import os
import subprocess
import time
from datetime import datetime
from pathlib import Path
from threading import Timer
from typing import Optional

import config

_log = logging.getLogger("orion.autopush")
_log_file = config.LOGS_DIR / "autopush.log"
_handler = logging.FileHandler(_log_file)
_handler.setFormatter(logging.Formatter("%(asctime)s  %(levelname)-8s  %(message)s"))
_log.addHandler(_handler)
_log.setLevel(getattr(logging, config.LOG_LEVEL, logging.INFO))

IGNORE_PATTERNS = [
    ".env",
    "__pycache__",
    ".pyc",
    "logs/",
    ".git/",
    ".git\\",
    "chroma_data/",
    "chroma_data\\",
    ".DS_Store",
    "Thumbs.db",
    "*.swp",
    "*.swo",
    "*~",
]


class AutoPusher:
    """
    Watches a directory and auto-commits/pushes on file changes.

    Uses watchdog for efficient file system monitoring.
    Debounces changes for 3 seconds before committing.

    Attributes:
        path: Directory to watch.
        debounce_seconds: Seconds to wait before committing.

    Example:
        pusher = AutoPusher(".", debounce_seconds=3)
        pusher.start()
    """

    def __init__(self, path: str = ".", debounce_seconds: int = 3) -> None:
        """
        Initialize the AutoPusher.

        Args:
            path: Directory path to watch. Defaults to current directory.
            debounce_seconds: Debounce interval in seconds. Defaults to 3.
        """
        self.path = Path(path).resolve()
        self.debounce_seconds = debounce_seconds
        self._timer: Optional[Timer] = None
        self._pending_files: set[str] = set()
        self._running = False
        self._observer = None

    def _should_ignore(self, file_path: str) -> bool:
        """
        Check if a file path should be ignored.

        Args:
            file_path: Path to check.

        Returns:
            True if the path should be ignored.
        """
        file_path_normalized = file_path.replace("\\", "/")

        for pattern in IGNORE_PATTERNS:
            pattern_normalized = pattern.replace("\\", "/")

            if pattern_normalized.endswith("/"):
                if pattern_normalized[:-1] in file_path_normalized:
                    return True
            elif pattern_normalized.startswith("*"):
                if file_path_normalized.endswith(pattern_normalized[1:]):
                    return True
            else:
                if pattern_normalized in file_path_normalized:
                    return True

        return False

    def _on_change(self, file_path: str) -> None:
        """
        Handle a file change event.

        Args:
            file_path: Path to the changed file.
        """
        if self._should_ignore(file_path):
            return

        _log.debug("Change detected: %s", file_path)

        self._pending_files.add(file_path)

        if self._timer is not None:
            self._timer.cancel()

        self._timer = Timer(self.debounce_seconds, self._commit_and_push)
        self._timer.start()

    def _commit_and_push(self) -> None:
        """
        Stage, commit, and push all pending changes.
        """
        if not self._pending_files:
            return

        files = list(self._pending_files)
        self._pending_files.clear()

        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        file_names = [Path(f).name for f in files[:3]]
        if len(files) > 3:
            file_names.append(f"...and {len(files) - 3} more")

        message = f"auto: [{timestamp}] {', '.join(file_names)}"

        print(f"\n[AutoPush] Committing {len(files)} file(s)...")

        try:
            result = subprocess.run(
                ["git", "add", "."],
                cwd=self.path,
                capture_output=True,
                text=True,
                timeout=30,
            )

            result = subprocess.run(
                ["git", "commit", "-m", message],
                cwd=self.path,
                capture_output=True,
                text=True,
                timeout=30,
            )

            if result.returncode != 0:
                if "nothing to commit" in result.stdout.lower():
                    print("[AutoPush] Nothing to commit")
                    return
                print(f"[AutoPush] Commit warning: {result.stderr}")

            print(f"[AutoPush] Committed: {message}")

            result = subprocess.run(
                ["git", "push", "origin", "main"],
                cwd=self.path,
                capture_output=True,
                text=True,
                timeout=60,
            )

            if result.returncode != 0:
                print(f"[AutoPush] Push failed: {result.stderr}")
                _log.error("Push failed: %s", result.stderr)
            else:
                print("[AutoPush] Pushed to origin/main")
                _log.info("Auto-pushed: %s", message)

        except subprocess.TimeoutExpired:
            print("[AutoPush] Git operation timed out")
            _log.error("Git operation timed out")
        except Exception as exc:
            print(f"[AutoPush] Error: {exc}")
            _log.error("Auto-push error: %s", exc)

    def start(self) -> None:
        """
        Start watching the directory for changes.

        Blocks until interrupted.
        """
        print(f"[AutoPush] Watching: {self.path}")
        print(f"[AutoPush] Debounce: {self.debounce_seconds}s")
        print("[AutoPush] Press Ctrl+C to stop")
        _log.info("AutoPusher started watching %s", self.path)

        self._running = True

        try:
            from watchdog.observers import Observer
            from watchdog.events import FileSystemEventHandler, FileSystemEvent

            class Handler(FileSystemEventHandler):
                def __init__(self, pusher: AutoPusher):
                    self.pusher = pusher

                def on_modified(self, event: FileSystemEvent) -> None:
                    if not event.is_directory:
                        self.pusher._on_change(str(event.src_path))

                def on_created(self, event: FileSystemEvent) -> None:
                    if not event.is_directory:
                        self.pusher._on_change(str(event.src_path))

            handler = Handler(self)
            self._observer = Observer()
            self._observer.schedule(handler, str(self.path), recursive=True)
            self._observer.start()

            while self._running:
                time.sleep(1)

        except ImportError:
            print("[AutoPush] watchdog not installed, using polling fallback")
            _log.warning("watchdog not available, using polling")
            self._polling_loop()

    def _polling_loop(self) -> None:
        """
        Fallback polling loop when watchdog is not available.
        """
        last_check = time.time()

        while self._running:
            time.sleep(1)

            try:
                result = subprocess.run(
                    ["git", "status", "--porcelain"],
                    cwd=self.path,
                    capture_output=True,
                    text=True,
                    timeout=10,
                )

                if result.stdout.strip():
                    changed = [
                        line[3:] for line in result.stdout.strip().split("\n") if line
                    ]
                    for f in changed:
                        self._on_change(f)

            except Exception as exc:
                _log.debug("Polling check failed: %s", exc)

    def stop(self) -> None:
        """
        Stop watching the directory.
        """
        self._running = False

        if self._timer is not None:
            self._timer.cancel()
            self._timer = None

        if self._observer is not None:
            self._observer.stop()
            self._observer.join()

        if self._pending_files:
            self._commit_and_push()

        print("[AutoPush] Stopped")
        _log.info("AutoPusher stopped")


def watch_directory(path: str = ".", interval: int = 30) -> None:
    """
    Watch a directory for file changes and auto-commit/push.

    Args:
        path: The directory path to watch. Defaults to current directory.
        interval: Debounce interval in seconds. Defaults to 30.

    Returns:
        None — runs indefinitely.
    """
    pusher = AutoPusher(path, debounce_seconds=interval)
    try:
        pusher.start()
    except KeyboardInterrupt:
        pusher.stop()


def auto_commit_and_push(message: Optional[str] = None) -> bool:
    """
    Stage all changes, commit with an auto-generated message, and push.

    Args:
        message: Optional custom commit message. If None, auto-generates.

    Returns:
        True if commit and push succeeded, False otherwise.
    """
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    commit_msg = message or f"auto: [{timestamp}] manual trigger"

    try:
        subprocess.run(["git", "add", "."], check=True, timeout=30)
        subprocess.run(["git", "commit", "-m", commit_msg], check=True, timeout=30)
        subprocess.run(["git", "push", "origin", "main"], check=True, timeout=60)
        print(f"[AutoPush] Committed and pushed: {commit_msg}")
        return True
    except subprocess.CalledProcessError as exc:
        print(f"[AutoPush] Git error: {exc}")
        return False
    except Exception as exc:
        print(f"[AutoPush] Error: {exc}")
        return False


def get_changed_files() -> list[str]:
    """
    Get a list of files that have been modified since the last commit.

    Returns:
        A list of file path strings that have changes.
    """
    try:
        result = subprocess.run(
            ["git", "status", "--porcelain"],
            capture_output=True,
            text=True,
            timeout=10,
        )

        if result.returncode == 0:
            return [line[3:] for line in result.stdout.strip().split("\n") if line]
        return []
    except Exception:
        return []


if __name__ == "__main__":
    watch_directory()
