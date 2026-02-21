"""
engines.auth package.

Authentication helpers for OAuth and API-key provider access.
Part of Orion - Persistent AI Companion System.
"""

from engines.auth.manager import AuthManager
from engines.auth.manager import get_auth_manager

__all__ = ["AuthManager", "get_auth_manager"]
