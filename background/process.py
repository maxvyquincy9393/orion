"""
process.py

Daemon process that runs continuously in the background.
This is the heartbeat of Orion — it never sleeps.
Monitors triggers, manages threads, and initiates proactive outreach.
Part of Orion — Persistent AI Companion System.
"""


def start_daemon() -> None:
    """
    Start the Orion background daemon process.
    Runs continuously, monitoring for triggers and managing active threads.
    This is the main entry point for the background service.

    Returns:
        None — runs indefinitely until stopped.

    Example:
        start_daemon()
    """
    raise NotImplementedError


def stop_daemon() -> None:
    """
    Gracefully stop the Orion background daemon.

    Returns:
        None

    Example:
        stop_daemon()
    """
    raise NotImplementedError


def health_check() -> dict:
    """
    Check the health status of the background daemon.

    Returns:
        A dict with status info: uptime, active_threads, last_trigger, etc.

    Example:
        status = health_check()
        # {"status": "running", "uptime_seconds": 3600, "active_threads": 2}
    """
    raise NotImplementedError


def run_cycle() -> None:
    """
    Execute a single daemon cycle: check triggers, update threads,
    send proactive messages if needed. Called repeatedly by start_daemon.

    Returns:
        None

    Example:
        run_cycle()
    """
    raise NotImplementedError
