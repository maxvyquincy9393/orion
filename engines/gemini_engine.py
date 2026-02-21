"""
gemini_engine.py

Google Gemini engine implementation using OAuth2 authentication.
Connects to the Google Generative AI API using tokens managed by auth/token_manager.py.
Part of Orion — Persistent AI Companion System.
"""

import logging
from typing import Iterator

import config
from engines.base import BaseEngine

_log = logging.getLogger("orion.engines.gemini")
_handler = logging.FileHandler(config.LOGS_DIR / "engines.log")
_handler.setFormatter(logging.Formatter("%(asctime)s  %(levelname)-8s  %(message)s"))
_log.addHandler(_handler)
_log.setLevel(getattr(logging, config.LOG_LEVEL, logging.INFO))


class GeminiEngine(BaseEngine):
    """
    LLM engine for Google Gemini.
    Uses OAuth2 tokens for authentication.
    Best suited for: multimodal tasks, fast generation, Google ecosystem integration.
    """

    def __init__(self, model: str = "gemini-pro") -> None:
        """
        Initialize the Gemini engine.

        Args:
            model: The Google Gemini model to use. Defaults to "gemini-pro".
        """
        self.model = model
        self._client = None

    def _get_client(self):
        """
        Lazily create the Gemini client using OAuth token.

        Returns:
            Gemini GenerativeModel instance or None if unavailable.
        """
        if self._client is not None:
            return self._client

        token = config.GOOGLE_ACCESS_TOKEN
        if not token:
            _log.debug("Google access token not configured")
            return None

        try:
            import google.generativeai as genai

            genai.configure(api_key=token)
            self._client = genai.GenerativeModel(self.model)
            _log.info("Gemini client initialised with OAuth token")
            return self._client
        except Exception as exc:
            _log.error("Failed to initialise Gemini client: %s", exc)
            return None

    def get_name(self) -> str:
        """Return the engine name identifier."""
        return "gemini"

    def _build_history(self, context: list[dict]) -> list[dict]:
        """
        Build Gemini-compatible chat history from context.

        Gemini uses a different format: parts with text content.

        Args:
            context: List of message dicts with role/content.

        Returns:
            List of Gemini-format history entries.
        """
        history = []
        for msg in context:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            if role == "system":
                continue
            gemini_role = "user" if role == "user" else "model"
            history.append({"role": gemini_role, "parts": [content]})
        return history

    def generate(self, prompt: str, context: list[dict]) -> str:
        """
        Generate a complete response from Gemini.

        Args:
            prompt: The user's message or instruction.
            context: A list of prior message dicts (role, content).

        Returns:
            The full response string from Gemini.
        """
        client = self._get_client()
        if client is None:
            return "[Error] Gemini engine unavailable: no valid token"

        system_instruction = None
        for msg in context:
            if msg.get("role") == "system":
                system_instruction = msg.get("content", "")
                break

        try:
            import google.generativeai as genai

            model_kwargs = {}
            if system_instruction:
                model_kwargs["system_instruction"] = system_instruction

            model = genai.GenerativeModel(self.model, **model_kwargs)
            history = self._build_history(context)

            chat = model.start_chat(history=history)
            response = chat.send_message(prompt)
            result = response.text if response.text else ""
            _log.info("Gemini generate: %d chars returned", len(result))
            return result
        except Exception as exc:
            _log.error("Gemini generate error: %s", exc)
            return f"[Error] Gemini API error: {exc}"

    def stream(self, prompt: str, context: list[dict]) -> Iterator[str]:
        """
        Stream a response from Gemini token by token.

        Args:
            prompt: The user's message or instruction.
            context: A list of prior message dicts (role, content).

        Yields:
            String chunks of the response as they arrive.
        """
        client = self._get_client()
        if client is None:
            yield "[Error] Gemini engine unavailable: no valid token"
            return

        system_instruction = None
        for msg in context:
            if msg.get("role") == "system":
                system_instruction = msg.get("content", "")
                break

        try:
            import google.generativeai as genai

            model_kwargs = {}
            if system_instruction:
                model_kwargs["system_instruction"] = system_instruction

            model = genai.GenerativeModel(self.model, **model_kwargs)
            history = self._build_history(context)

            chat = model.start_chat(history=history)
            response = chat.send_message(prompt, stream=True)

            for chunk in response:
                if chunk.text:
                    yield chunk.text
        except Exception as exc:
            _log.error("Gemini stream error: %s", exc)
            yield f"[Error] Gemini API error: {exc}"

    def is_available(self) -> bool:
        """
        Check if the Gemini engine is available (valid token, API reachable).

        Returns:
            True if Gemini can accept requests, False otherwise.
        """
        client = self._get_client()
        if client is None:
            return False

        try:
            response = client.generate_content("ping")
            _log.debug("Gemini engine is available")
            return True
        except Exception as exc:
            error_str = str(exc).lower()
            if "rate" in error_str or "quota" in error_str:
                _log.debug("Gemini rate limited but available")
                return True
            _log.warning("Gemini availability check failed: %s", exc)
            return False
