"""
local_engine.py

Ollama local model engine implementation.
Runs entirely on localhost — no API keys or OAuth required.
Connects to the Ollama service at http://localhost:11434.
Part of Orion — Persistent AI Companion System.
"""

import json
import logging
from typing import Iterator

import requests

import config
from engines.base import BaseEngine

_log = logging.getLogger("orion.engines.local")
_handler = logging.FileHandler(config.LOGS_DIR / "engines.log")
_handler.setFormatter(logging.Formatter("%(asctime)s  %(levelname)-8s  %(message)s"))
_log.addHandler(_handler)
_log.setLevel(getattr(logging, config.LOG_LEVEL, logging.INFO))


class LocalEngine(BaseEngine):
    """
    LLM engine for Ollama local models.
    No authentication required — runs on localhost.
    Best suited for: fast responses, offline use, privacy-sensitive tasks.
    """

    def __init__(self, model: str | None = None, base_url: str | None = None) -> None:
        """
        Initialize the local Ollama engine.

        Args:
            model: The Ollama model to use. Defaults to config or "llama3".
            base_url: The Ollama API base URL. Defaults to config or localhost.
        """
        self.model = model or getattr(config, "OLLAMA_MODEL", "llama3")
        self.base_url = base_url or config.OLLAMA_BASE_URL

    def get_name(self) -> str:
        """Return the engine name identifier."""
        return "local"

    def generate(self, prompt: str, context: list[dict]) -> str:
        """
        Generate a complete response from the local Ollama model.

        Args:
            prompt: The user's message or instruction.
            context: A list of prior message dicts (role, content).

        Returns:
            The full response string from the local model.
        """
        if not self.is_available():
            return "[Error] Local engine unavailable: Ollama not running"

        messages = self.format_messages(prompt, context)

        try:
            response = requests.post(
                f"{self.base_url}/api/chat",
                json={
                    "model": self.model,
                    "messages": messages,
                    "stream": False,
                },
                timeout=120,
            )
            response.raise_for_status()
            data = response.json()
            result = data.get("message", {}).get("content", "")
            _log.info("Local generate: %d chars returned", len(result))
            return result
        except requests.exceptions.Timeout:
            _log.error("Local generate timeout")
            return "[Error] Local engine timeout"
        except requests.exceptions.RequestException as exc:
            _log.error("Local generate error: %s", exc)
            return f"[Error] Ollama error: {exc}"
        except Exception as exc:
            _log.error("Local generate unexpected error: %s", exc)
            return f"[Error] Unexpected error: {exc}"

    def stream(self, prompt: str, context: list[dict]) -> Iterator[str]:
        """
        Stream a response from the local Ollama model token by token.

        Args:
            prompt: The user's message or instruction.
            context: A list of prior message dicts (role, content).

        Yields:
            String chunks of the response as they arrive.
        """
        if not self.is_available():
            yield "[Error] Local engine unavailable: Ollama not running"
            return

        messages = self.format_messages(prompt, context)

        try:
            response = requests.post(
                f"{self.base_url}/api/chat",
                json={
                    "model": self.model,
                    "messages": messages,
                    "stream": True,
                },
                timeout=120,
                stream=True,
            )
            response.raise_for_status()

            for line in response.iter_lines():
                if line:
                    try:
                        data = json.loads(line)
                        if "message" in data:
                            content = data["message"].get("content", "")
                            if content:
                                yield content
                    except json.JSONDecodeError:
                        continue
        except requests.exceptions.Timeout:
            _log.error("Local stream timeout")
            yield "[Error] Local engine timeout"
        except requests.exceptions.RequestException as exc:
            _log.error("Local stream error: %s", exc)
            yield f"[Error] Ollama error: {exc}"
        except Exception as exc:
            _log.error("Local stream unexpected error: %s", exc)
            yield f"[Error] Unexpected error: {exc}"

    def is_available(self) -> bool:
        """
        Check if Ollama is running and the specified model is loaded.

        Returns:
            True if the local engine can accept requests, False otherwise.
        """
        try:
            response = requests.get(f"{self.base_url}/api/tags", timeout=5)
            if response.status_code == 200:
                data = response.json()
                models = [m.get("name", "") for m in data.get("models", [])]
                if any(self.model in m or m.startswith(self.model) for m in models):
                    _log.debug("Local engine is available with model %s", self.model)
                    return True
                _log.debug(
                    "Ollama running but model %s not found. Available: %s",
                    self.model,
                    models,
                )
                return True
            return False
        except requests.exceptions.RequestException as exc:
            _log.debug("Local engine unavailable: %s", exc)
            return False
        except Exception as exc:
            _log.warning("Local engine availability check error: %s", exc)
            return False
