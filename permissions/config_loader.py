"""
config_loader.py

Loads and parses permissions.yaml using PyYAML.
Returns a typed dict of the full permission configuration.
Supports hot reload via reload() — re-reads the file without restarting.
Validates required fields on every load.
Part of Orion — Persistent AI Companion System.
"""

import sys
import threading
from pathlib import Path
from typing import Any

import yaml

# ---------------------------------------------------------------------------
# DECISION: Use a module-level singleton for the config to allow hot reload
# WHY: Multiple modules import config_loader — they should all see the same state
# ALTERNATIVES CONSIDERED: Pass config object around (too verbose)
# REVISIT: If we need per-test isolation, switch to dependency injection
# ---------------------------------------------------------------------------

# Required top-level sections in permissions.yaml
_REQUIRED_SECTIONS: list[str] = [
    "browsing",
    "search",
    "file_system",
    "terminal",
    "app_control",
    "input_control",
    "calendar",
    "system_info",
    "camera",
    "voice",
    "proactive",
]

# Fields that every section must have (at minimum)
_REQUIRED_FIELDS_PER_SECTION: dict[str, list[str]] = {
    "browsing": ["enabled"],
    "search": ["enabled", "engine"],
    "file_system": ["enabled", "read", "write", "delete"],
    "terminal": ["enabled"],
    "app_control": ["enabled"],
    "input_control": ["enabled"],
    "calendar": ["enabled", "read", "write"],
    "system_info": ["enabled"],
    "camera": ["enabled", "mode"],
    "voice": ["enabled", "tts_engine", "stt_engine"],
    "proactive": ["enabled", "max_messages_per_hour"],
}


class PermissionConfigLoader:
    """
    Singleton loader for permissions.yaml.

    Provides:
        - load(path) — initial load with validation
        - reload() — hot-reload from disk without restarting
        - get(section) — retrieve a specific permission section
        - get_all() — retrieve the full permissions dict

    Thread-safe via a reentrant lock.

    Example:
        loader = PermissionConfigLoader()
        loader.load("permissions/permissions.yaml")
        browsing = loader.get("browsing")
        loader.reload()  # pick up changes from disk
    """

    def __init__(self) -> None:
        self._config: dict[str, Any] = {}
        self._path: Path | None = None
        self._lock = threading.RLock()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def load(self, path: str | Path) -> dict[str, Any]:
        """
        Load permissions.yaml from disk, validate, and cache the result.

        Args:
            path: File path to permissions.yaml (absolute or relative to cwd).

        Returns:
            The full permissions dict (top-level key "permissions" unwrapped).

        Raises:
            FileNotFoundError: If the YAML file does not exist.
            ValueError: If required sections or fields are missing.
            yaml.YAMLError: If the file contains invalid YAML.

        Example:
            config = loader.load("permissions/permissions.yaml")
        """
        resolved = Path(path).resolve()
        if not resolved.is_file():
            raise FileNotFoundError(
                f"[Orion Permissions] Config file not found: {resolved}\n"
                f"  → Ensure permissions.yaml exists at the expected path."
            )

        with self._lock:
            self._path = resolved
            raw = self._read_yaml(resolved)
            self._config = self._validate(raw)
            return self._config

    def reload(self) -> dict[str, Any]:
        """
        Hot-reload permissions.yaml from disk without restarting.
        Re-reads and re-validates the file, then replaces the cached config.

        Returns:
            The newly loaded permissions dict.

        Raises:
            RuntimeError: If load() was never called first.
            FileNotFoundError: If the file no longer exists.
            ValueError: If the re-read file fails validation.

        Example:
            new_config = loader.reload()
        """
        with self._lock:
            if self._path is None:
                raise RuntimeError(
                    "[Orion Permissions] Cannot reload — load() has not been called yet."
                )
            raw = self._read_yaml(self._path)
            self._config = self._validate(raw)
            return self._config

    def get(self, section: str) -> dict[str, Any]:
        """
        Retrieve a single permission section by name.

        Args:
            section: The section key (e.g. "browsing", "file_system", "terminal").

        Returns:
            A dict of the section's configuration.

        Raises:
            KeyError: If the section does not exist.

        Example:
            fs = loader.get("file_system")
            if fs["enabled"] and fs["write"]:
                ...
        """
        with self._lock:
            if section not in self._config:
                raise KeyError(
                    f"[Orion Permissions] Section '{section}' not found in config. "
                    f"Available: {list(self._config.keys())}"
                )
            return dict(self._config[section])  # return a copy

    def get_all(self) -> dict[str, Any]:
        """
        Return the full permissions dict (all sections).

        Returns:
            A shallow copy of the entire permissions config.

        Example:
            all_perms = loader.get_all()
        """
        with self._lock:
            return dict(self._config)

    @property
    def path(self) -> Path | None:
        """Return the resolved path of the loaded YAML file."""
        return self._path

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _read_yaml(path: Path) -> dict[str, Any]:
        """
        Read and parse a YAML file.

        Args:
            path: Resolved path to the YAML file.

        Returns:
            The parsed YAML content as a dict.

        Raises:
            yaml.YAMLError: On invalid YAML.
        """
        with open(path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)

        if not isinstance(data, dict):
            raise ValueError(
                f"[Orion Permissions] Expected a YAML mapping at top level, got {type(data).__name__}."
            )
        return data

    @staticmethod
    def _validate(raw: dict[str, Any]) -> dict[str, Any]:
        """
        Validate the parsed YAML against expected schema.

        Args:
            raw: The full parsed YAML dict (should contain a "permissions" key).

        Returns:
            The unwrapped permissions dict (without the outer "permissions" key).

        Raises:
            ValueError: If any required section or field is missing.
        """
        if "permissions" not in raw:
            raise ValueError(
                "[Orion Permissions] YAML must have a top-level 'permissions' key."
            )

        perms = raw["permissions"]
        if not isinstance(perms, dict):
            raise ValueError(
                "[Orion Permissions] 'permissions' must be a mapping."
            )

        # Check required sections
        missing_sections = [s for s in _REQUIRED_SECTIONS if s not in perms]
        if missing_sections:
            raise ValueError(
                f"[Orion Permissions] Missing required sections: {missing_sections}\n"
                f"  → Add them to permissions.yaml. See SKILL.md for the full schema."
            )

        # Check required fields per section
        errors: list[str] = []
        for section, required_fields in _REQUIRED_FIELDS_PER_SECTION.items():
            if section not in perms:
                continue  # already caught above
            section_data = perms[section]
            if not isinstance(section_data, dict):
                errors.append(f"  Section '{section}' must be a mapping, got {type(section_data).__name__}.")
                continue
            for field in required_fields:
                if field not in section_data:
                    errors.append(f"  Section '{section}' is missing required field '{field}'.")

        if errors:
            joined = "\n".join(errors)
            raise ValueError(
                f"[Orion Permissions] Validation errors in permissions.yaml:\n{joined}"
            )

        return perms


# ---------------------------------------------------------------------------
# Module-level singleton instance
# ---------------------------------------------------------------------------
_loader = PermissionConfigLoader()


def load(path: str | Path) -> dict[str, Any]:
    """
    Load permissions.yaml (module-level convenience function).

    Args:
        path: Path to permissions.yaml.

    Returns:
        The validated permissions dict.

    Example:
        from permissions.config_loader import load, get, reload
        load("permissions/permissions.yaml")
    """
    return _loader.load(path)


def reload() -> dict[str, Any]:
    """
    Hot-reload permissions.yaml from disk (module-level convenience function).

    Returns:
        The newly loaded permissions dict.

    Example:
        reload()  # pick up changes without restarting
    """
    return _loader.reload()


def get(section: str) -> dict[str, Any]:
    """
    Get a single permission section (module-level convenience function).

    Args:
        section: Section name (e.g. "browsing", "terminal").

    Returns:
        A dict of the section config.

    Example:
        terminal = get("terminal")
    """
    return _loader.get(section)


def get_all() -> dict[str, Any]:
    """
    Get the full permissions dict (module-level convenience function).

    Returns:
        The complete permissions config.

    Example:
        all_perms = get_all()
    """
    return _loader.get_all()


def get_loader() -> PermissionConfigLoader:
    """
    Return the module-level singleton loader instance.
    Useful when you need direct access to the loader object.

    Returns:
        The PermissionConfigLoader singleton.

    Example:
        loader = get_loader()
        loader.reload()
    """
    return _loader
