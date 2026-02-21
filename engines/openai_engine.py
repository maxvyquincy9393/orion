"""
openai_engine.py

OpenAI engine implementation for Orion with multi-auth support.
Supports OpenAI OAuth bearer tokens and API keys via AuthManager.
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

_log = logging.getLogger("orion.engines.openai")
_handler = logging.FileHandler(config.LOGS_DIR / "engines.log")
_handler.setFormatter(logging.Formatter("%(asctime)s  %(levelname)-8s  %(message)s"))
_log.addHandler(_handler)
_log.setLevel(getattr(logging, config.LOG_LEVEL, logging.INFO))

OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions"
OPENAI_MODELS_URL = "https://api.openai.com/v1/models"


class OpenAIEngine(BaseEngine):
    """
    LLM engine for OpenAI models with OAuth and API key auth support.

    - OAuth token format from AuthManager: "Bearer <token>"
    - API key format from AuthManager: "sk-..."
    """

    def __init__(self, model: str = "gpt-5.2") -> None:
        """
        Initialize the OpenAI engine.

        Args:
            model: OpenAI model name.
        """
        self.model = model
        self.auth_manager = get_auth_manager()
        self._api_client = None
        self._api_client_key = ""

    def get_name(self) -> str:
        """Return the engine name identifier."""
        return "openai"

    def _resolve_token(self) -> tuple[str, str]:
        """
        Resolve OpenAI credential mode and token value.

        Returns:
            Tuple of (mode, token_value), where mode is "oauth" or "api_key".

        Raises:
            RuntimeError: If no OpenAI credential is available.
        """
        token = self.auth_manager.get_token("openai")
        if not token:
            raise RuntimeError(
                "OpenAI is not configured. Set OPENAI_API_KEY or login with OpenAI OAuth."
            )

        token = token.strip()

        if token.startswith("Bearer "):
            bearer_value = token[len("Bearer ") :].strip()
            if not bearer_value:
                raise RuntimeError("OpenAI OAuth token is invalid")
            return "oauth", bearer_value

        if token.startswith("sk-"):
            return "api_key", token

        raise RuntimeError(
            "OpenAI credential format is unsupported. Expected OAuth Bearer token or sk- API key."
        )

    def _get_api_client(self, api_key: str):
        """
        Create or reuse OpenAI API-key client.

        Args:
            api_key: OpenAI API key.

        Returns:
            OpenAI client instance.
        """
        if self._api_client is not None and self._api_client_key == api_key:
            return self._api_client

        from openai import OpenAI

        self._api_client = OpenAI(api_key=api_key)
        self._api_client_key = api_key
        return self._api_client

    def _generate_with_oauth(self, prompt: str, context: list[dict], token: str) -> str:
        """
        Generate response using OpenAI REST API with OAuth bearer token.

        Args:
            prompt: User prompt.
            context: Prior context messages.
            token: OAuth access token (without Bearer prefix).

        Returns:
            Response text.
        """
        messages = self.format_messages(prompt, context)

        try:
            response = requests.post(
                OPENAI_CHAT_COMPLETIONS_URL,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self.model,
                    "messages": messages,
                },
                timeout=120,
            )
            response.raise_for_status()
            payload = response.json()
            result = (
                payload.get("choices", [{}])[0]
                .get("message", {})
                .get("content", "")
            )
            _log.info("OpenAI OAuth generate: %d chars returned", len(result))
            return result
        except requests.exceptions.RequestException as exc:
            _log.error("OpenAI OAuth generate error: %s", exc)
            return f"[Error] OpenAI OAuth API error: {exc}"
        except Exception as exc:
            _log.error("OpenAI OAuth generate parse error: %s", exc)
            return f"[Error] OpenAI OAuth response parse error: {exc}"

    def _generate_with_api_key(
        self,
        prompt: str,
        context: list[dict],
        api_key: str,
    ) -> str:
        """
        Generate response using OpenAI SDK and API key.

        Args:
            prompt: User prompt.
            context: Prior context messages.
            api_key: OpenAI API key.

        Returns:
            Response text.
        """
        client = self._get_api_client(api_key)
        messages = self.format_messages(prompt, context)

        try:
            response = client.chat.completions.create(
                model=self.model,
                messages=messages,
            )
            result = response.choices[0].message.content or ""
            _log.info("OpenAI API key generate: %d chars returned", len(result))
            return result
        except Exception as exc:
            _log.error("OpenAI API key generate error: %s", exc)
            return f"[Error] OpenAI API error: {exc}"

    def generate(self, prompt: str, context: list[dict]) -> str:
        """
        Generate a complete response from OpenAI.

        Args:
            prompt: User prompt.
            context: Prior context messages.

        Returns:
            Response text.

        Raises:
            RuntimeError: If no valid OpenAI credential is configured.
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
        Stream response using OpenAI REST API with OAuth bearer token.

        Args:
            prompt: User prompt.
            context: Prior context messages.
            token: OAuth access token.

        Yields:
            Response chunks.
        """
        messages = self.format_messages(prompt, context)

        try:
            response = requests.post(
                OPENAI_CHAT_COMPLETIONS_URL,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self.model,
                    "messages": messages,
                    "stream": True,
                },
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

                payload = line[len("data:") :].strip()
                if payload == "[DONE]":
                    break

                try:
                    chunk = json.loads(payload)
                except json.JSONDecodeError:
                    continue

                delta = (
                    chunk.get("choices", [{}])[0]
                    .get("delta", {})
                    .get("content", "")
                )
                if delta:
                    yield delta
        except Exception as exc:
            _log.error("OpenAI OAuth stream error: %s", exc)
            yield f"[Error] OpenAI OAuth API error: {exc}"

    def _stream_with_api_key(
        self,
        prompt: str,
        context: list[dict],
        api_key: str,
    ) -> Iterator[str]:
        """
        Stream response using OpenAI SDK and API key.

        Args:
            prompt: User prompt.
            context: Prior context messages.
            api_key: OpenAI API key.

        Yields:
            Response chunks.
        """
        client = self._get_api_client(api_key)
        messages = self.format_messages(prompt, context)

        try:
            stream = client.chat.completions.create(
                model=self.model,
                messages=messages,
                stream=True,
            )
            for chunk in stream:
                if chunk.choices and chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content
        except Exception as exc:
            _log.error("OpenAI API key stream error: %s", exc)
            yield f"[Error] OpenAI API error: {exc}"

    def stream(self, prompt: str, context: list[dict]) -> Iterator[str]:
        """
        Stream a response from OpenAI.

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
        Check if OpenAI credentials are configured and endpoint is reachable.

        Returns:
            True if OpenAI is usable, otherwise False.
        """
        try:
            mode, token = self._resolve_token()
        except RuntimeError:
            return False

        if mode == "oauth":
            try:
                response = requests.get(
                    OPENAI_MODELS_URL,
                    headers={"Authorization": f"Bearer {token}"},
                    timeout=15,
                )
                return response.ok
            except requests.RequestException:
                return False

        try:
            client = self._get_api_client(token)
            client.models.list()
            return True
        except Exception:
            return False
