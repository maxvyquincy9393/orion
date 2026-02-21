"""
callback_server.py

Local HTTP server that catches OAuth2 redirect callbacks.
Listens on http://localhost:8080/callback/{provider} and captures
the authorization code from the OAuth flow.
Part of Orion — Persistent AI Companion System.
"""

from typing import Optional, Callable


def start_callback_server(port: int = 8080) -> None:
    """
    Start the local HTTP callback server to listen for OAuth redirects.

    Args:
        port: The port to listen on. Defaults to 8080.

    Returns:
        None — blocks until a callback is received or timeout.

    Example:
        start_callback_server(port=8080)
    """
    raise NotImplementedError


def stop_callback_server() -> None:
    """
    Stop the running callback server gracefully.

    Returns:
        None

    Example:
        stop_callback_server()
    """
    raise NotImplementedError


def wait_for_code(timeout: int = 120) -> Optional[str]:
    """
    Block and wait for an authorization code to arrive via callback.

    Args:
        timeout: Maximum seconds to wait for the callback.

    Returns:
        The authorization code string, or None if timeout.

    Example:
        code = wait_for_code(timeout=60)
    """
    raise NotImplementedError
