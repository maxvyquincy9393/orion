"""
gemini_engine.py

Google Gemini engine implementation for Orion with multi-auth support.
Supports OAuth bearer tokens and API keys via AuthManager.
Part of Orion - Persistent AI Companion System.
"""

from __future__ import annotations

import json
import logging
from typing import Iterator

import requests

import config
from engines.auth.manager import get_auth_manager
from engines.base import BaseEngine

_log = logging.getLogger("orion.engines.gemini")
_handler = logging.FileHandler(config.LOGS_DIR / "engines.log")
_handler.setFormatter(logging.Formatter("%(asctime)s  %(levelname)-8s  %(message)s"))
_log.addHandler(_handler)
_log.setLevel(getattr(logging, config.LOG_LEVEL, logging.INFO))

GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta"


class GeminiEngine(BaseEngine):
    """
    LLM engine for Google Gemini with OAuth and API key auth support.

    - OAuth token format from AuthManager: "Bearer <token>"
    - API key format from AuthManager: direct key string
    """

    def __init__(self, model: str = "gemini-3.1-pro") -> None:
        """
        Initialize the Gemini engine.

        Args:
            model: Gemini model name.
        """
        self.model = model
        self.auth_manager = get_auth_manager()

    def get_name(self) -> str:
        """Return the engine name identifier."""
        return "gemini"

    def _resolve_token(self) -> tuple[str, str]:
        """
        Resolve Gemini credential mode and token value.

        Returns:
            Tuple of (mode, token_value), where mode is "oauth" or "api_key".

        Raises:
            RuntimeError: If no Gemini credential is available.
        """
        token = self.auth_manager.get_token("gemini")
        if not token:
            raise RuntimeError(
                "Gemini is not configured. Set GEMINI_API_KEY or login with Gemini OAuth."
            )

        token = token.strip()
        if token.startswith("Bearer "):
            bearer_value = token[len("Bearer ") :].strip()
            if not bearer_value:
                raise RuntimeError("Gemini OAuth token is invalid")
            return "oauth", bearer_value

        return "api_key", token

    def _build_history(self, context: list[dict]) -> list[dict]:
        """
        Build Gemini-compatible chat history for SDK mode.

        Args:
            context: List of message dicts with role/content.

        Returns:
            List of Gemini history entries.
        """
        history = []
        for msg in context:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            if not content or role == "system":
                continue
            gemini_role = "user" if role == "user" else "model"
            history.append({"role": gemini_role, "parts": [content]})
        return history

    def _build_rest_payload(self, prompt: str, context: list[dict]) -> dict:
        """
        Build Gemini REST payload for OAuth mode.

        Args:
            prompt: User prompt.
            context: Prior context messages.

        Returns:
            Request payload dict for Gemini REST API.
        """
        contents: list[dict] = []
        system_instruction = ""

        for msg in context:
            role = msg.get("role", "user")
            text = msg.get("content", "")
            if not text:
                continue

            if role == "system":
                if not system_instruction:
                    system_instruction = text
                continue

            contents.append(
                {
                    "role": "user" if role == "user" else "model",
                    "parts": [{"text": text}],
                }
            )

        contents.append(
            {
                "role": "user",
                "parts": [{"text": prompt}],
            }
        )

        payload: dict = {
            "contents": contents,
        }

        if system_instruction:
            payload["systemInstruction"] = {
                "parts": [{"text": system_instruction}],
            }

        return payload

    def _parse_rest_text(self, payload: dict) -> str:
        """Extract text content from Gemini REST response payload."""
        candidates = payload.get("candidates", [])
        if not candidates:
            return ""

        content = candidates[0].get("content", {})
        parts = content.get("parts", [])

        texts: list[str] = []
        for part in parts:
            text = part.get("text")
            if text:
                texts.append(text)

        return "".join(texts)

    def _generate_with_oauth(self, prompt: str, context: list[dict], token: str) -> str:
        """
        Generate response via Gemini REST API with OAuth bearer token.

        Args:
            prompt: User prompt.
            context: Prior context messages.
            token: OAuth access token.

        Returns:
            Response text.
        """
        url = f"{GEMINI_API_BASE}/models/{self.model}:generateContent"
        payload = self._build_rest_payload(prompt, context)

        try:
            response = requests.post(
                url,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                json=payload,
                timeout=120,
            )
            response.raise_for_status()
            result = self._parse_rest_text(response.json())
            _log.info("Gemini OAuth generate: %d chars returned", len(result))
            return result
        except requests.exceptions.RequestException as exc:
            _log.error("Gemini OAuth generate error: %s", exc)
            return f"[Error] Gemini OAuth API error: {exc}"
        except Exception as exc:
            _log.error("Gemini OAuth generate parse error: %s", exc)
            return f"[Error] Gemini OAuth response parse error: {exc}"

    def _generate_with_api_key(
        self,
        prompt: str,
        context: list[dict],
        api_key: str,
    ) -> str:
        """
        Generate response using google.generativeai API-key mode.

        Args:
            prompt: User prompt.
            context: Prior context messages.
            api_key: Gemini API key.

        Returns:
            Response text.
        """
        try:
            import google.generativeai as genai

            genai.configure(api_key=api_key)

            model_kwargs = {}
            for msg in context:
                if msg.get("role") == "system" and msg.get("content"):
                    model_kwargs["system_instruction"] = msg["content"]
                    break

            model = genai.GenerativeModel(self.model, **model_kwargs)
            history = self._build_history(context)
            chat = model.start_chat(history=history)
            response = chat.send_message(prompt)

            result = response.text if response.text else ""
            _log.info("Gemini API key generate: %d chars returned", len(result))
            return result
        except Exception as exc:
            _log.error("Gemini API key generate error: %s", exc)
            return f"[Error] Gemini API error: {exc}"

    def generate(self, prompt: str, context: list[dict]) -> str:
        """
        Generate a complete response from Gemini.

        Args:
            prompt: User prompt.
            context: Prior context messages.

        Returns:
            Response text.

        Raises:
            RuntimeError: If no valid Gemini credential is configured.
        """
        mode, token = self._resolve_token()

        if mode == "oauth":
            return self._generate_with_oauth(prompt, context, token)

        return self._generate_with_api_key(prompt, context, token)

    def _stream_with_oauth(
        self,
        prompt: str,
        context: list[dict],
        token: str,
    ) -> Iterator[str]:
        """
        Stream response via Gemini REST API with OAuth bearer token.

        Args:
            prompt: User prompt.
            context: Prior context messages.
            token: OAuth access token.

        Yields:
            Response chunks.
        """
        url = f"{GEMINI_API_BASE}/models/{self.model}:streamGenerateContent?alt=sse"
        payload = self._build_rest_payload(prompt, context)

        try:
            response = requests.post(
                url,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                json=payload,
                timeout=120,
                stream=True,
            )
            response.raise_for_status()

            for raw_line in response.iter_lines(decode_unicode=True):
                if not raw_line:
                    continue

                line = raw_line.strip()
                if not line.startswith("data:"):
                    continue

                chunk_payload = line[len("data:") :].strip()
                if not chunk_payload:
                    continue

                try:
                    chunk_json = json.loads(chunk_payload)
                except json.JSONDecodeError:
                    continue

                text = self._parse_rest_text(chunk_json)
                if text:
                    yield text
        except Exception as exc:
            _log.error("Gemini OAuth stream error: %s", exc)
            yield f"[Error] Gemini OAuth API error: {exc}"

    def _stream_with_api_key(
        self,
        prompt: str,
        context: list[dict],
        api_key: str,
    ) -> Iterator[str]:
        """
        Stream response using google.generativeai API-key mode.

        Args:
            prompt: User prompt.
            context: Prior context messages.
            api_key: Gemini API key.

        Yields:
            Response chunks.
        """
        try:
            import google.generativeai as genai

            genai.configure(api_key=api_key)

            model_kwargs = {}
            for msg in context:
                if msg.get("role") == "system" and msg.get("content"):
                    model_kwargs["system_instruction"] = msg["content"]
                    break

            model = genai.GenerativeModel(self.model, **model_kwargs)
            history = self._build_history(context)
            chat = model.start_chat(history=history)

            response = chat.send_message(prompt, stream=True)
            for chunk in response:
                if chunk.text:
                    yield chunk.text
        except Exception as exc:
            _log.error("Gemini API key stream error: %s", exc)
            yield f"[Error] Gemini API error: {exc}"

    def stream(self, prompt: str, context: list[dict]) -> Iterator[str]:
        """
        Stream a response from Gemini.

        Args:
            prompt: User prompt.
            context: Prior context messages.

        Yields:
            Response chunks.
        """
        try:
            mode, token = self._resolve_token()
        except RuntimeError as exc:
            yield f"[Error] {exc}"
            return

        if mode == "oauth":
            yield from self._stream_with_oauth(prompt, context, token)
            return

        yield from self._stream_with_api_key(prompt, context, token)

    def is_available(self) -> bool:
        """
        Check if Gemini credentials are configured and endpoint is reachable.

        Returns:
            True if Gemini is usable, otherwise False.
        """
        try:
            mode, token = self._resolve_token()
        except RuntimeError:
            return False

        if mode == "oauth":
            try:
                response = requests.get(
                    f"{GEMINI_API_BASE}/models",
                    headers={"Authorization": f"Bearer {token}"},
                    timeout=15,
                )
                return response.ok
            except requests.RequestException:
                return False

        try:
            import google.generativeai as genai

            genai.configure(api_key=token)
            list(genai.list_models())
            return True
        except Exception:
            return False
