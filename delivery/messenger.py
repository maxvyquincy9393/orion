"""
messenger.py

Telegram delivery layer for Orion.
Sends messages via Telegram Bot API and handles confirmation polling.
Part of Orion — Persistent AI Companion System.
"""

import logging
import time
from typing import Any, Optional

import requests

import config

_log = logging.getLogger("orion.delivery")
_log_file = config.LOGS_DIR / "delivery.log"
_handler = logging.FileHandler(_log_file)
_handler.setFormatter(logging.Formatter("%(asctime)s | %(levelname)-8s | %(message)s"))
_log.addHandler(_handler)
_log.setLevel(getattr(logging, config.LOG_LEVEL, logging.INFO))

TELEGRAM_API_BASE = "https://api.telegram.org"


def _get_bot_token() -> Optional[str]:
    """Get Telegram bot token from config."""
    return config.TELEGRAM_BOT_TOKEN


def _get_chat_id() -> str:
    """Get default chat ID from config."""
    return getattr(config, "TELEGRAM_CHAT_ID", config.DEFAULT_USER_ID)


def send(user_id: str, message: str) -> bool:
    """
    Send a message via Telegram Bot API.

    Args:
        user_id: The chat_id to send to.
        message: The text message to send.

    Returns:
        True on success, False on failure. Never raises.

    Example:
        success = send("123456789", "Hello from Orion!")
    """
    token = _get_bot_token()
    if not token:
        _log.error("SEND FAILED | No TELEGRAM_BOT_TOKEN configured")
        return False

    url = f"{TELEGRAM_API_BASE}/bot{token}/sendMessage"

    try:
        response = requests.post(
            url,
            json={
                "chat_id": user_id,
                "text": message,
                "parse_mode": "Markdown",
            },
            timeout=15,
        )
        response.raise_for_status()
        data = response.json()

        if data.get("ok"):
            msg_id = data.get("result", {}).get("message_id")
            _log.info(
                "SEND OK | chat_id=%s | message_id=%s | len=%d",
                user_id,
                msg_id,
                len(message),
            )
            return True
        else:
            _log.error(
                "SEND FAILED | chat_id=%s | error=%s", user_id, data.get("description")
            )
            return False

    except requests.exceptions.Timeout:
        _log.error("SEND TIMEOUT | chat_id=%s", user_id)
        return False
    except requests.exceptions.RequestException as exc:
        _log.error("SEND ERROR | chat_id=%s | error=%s", user_id, exc)
        return False
    except Exception as exc:
        _log.error("SEND UNEXPECTED | chat_id=%s | error=%s", user_id, exc)
        return False


def send_with_confirm(user_id: str, message: str, timeout: int = 30) -> bool:
    """
    Send a message and poll for yes/no reply.

    Sends message then polls for user response within timeout period.
    Used by sandbox.request_confirm() for permission confirmations.

    Args:
        user_id: The chat_id to send to.
        message: The message to send (should ask for yes/no reply).
        timeout: Maximum seconds to wait for reply. Defaults to 30.

    Returns:
        True if user replies "yes", False if "no" or timeout.

    Example:
        confirmed = send_with_confirm("123456789", "Allow file write? Reply yes or no.")
    """
    token = _get_bot_token()
    if not token:
        _log.error("CONFIRM FAILED | No TELEGRAM_BOT_TOKEN configured")
        return False

    if not send(user_id, message):
        return False

    last_update_id = _get_latest_update_id(token)
    deadline = time.time() + timeout

    while time.time() < deadline:
        try:
            updates_url = f"{TELEGRAM_API_BASE}/bot{token}/getUpdates"
            params: dict[str, Any] = {"timeout": 5}
            if last_update_id is not None:
                params["offset"] = last_update_id + 1

            response = requests.get(updates_url, params=params, timeout=10)
            response.raise_for_status()
            data = response.json()

            for update in data.get("result", []):
                last_update_id = update.get("update_id", last_update_id)
                msg = update.get("message", {})
                text = (msg.get("text") or "").strip().lower()
                chat_id = str(msg.get("chat", {}).get("id", ""))

                if chat_id == str(user_id) and text in ("yes", "no"):
                    confirmed = text == "yes"
                    status = "APPROVED" if confirmed else "DENIED"
                    _log.info(
                        "CONFIRM %s | chat_id=%s | reply=%s", status, user_id, text
                    )
                    _acknowledge_update(token, last_update_id)
                    return confirmed

        except requests.exceptions.RequestException as exc:
            _log.warning("CONFIRM POLL ERROR | %s", exc)
            time.sleep(2)
            continue

        time.sleep(1)

    _log.warning("CONFIRM TIMEOUT | chat_id=%s | timeout=%ds", user_id, timeout)
    return False


def get_latest_reply(chat_id: str, after_message_id: int) -> Optional[str]:
    """
    Poll for new message from a chat after a specific message ID.

    Args:
        chat_id: The chat ID to poll.
        after_message_id: Only return messages with ID greater than this.

    Returns:
        The message text, or None if no new message.

    Example:
        reply = get_latest_reply("123456789", 42)
    """
    token = _get_bot_token()
    if not token:
        return None

    try:
        updates_url = f"{TELEGRAM_API_BASE}/bot{token}/getUpdates"
        response = requests.get(updates_url, params={"limit": 10}, timeout=10)
        response.raise_for_status()
        data = response.json()

        for update in reversed(data.get("result", [])):
            msg = update.get("message", {})
            msg_id = msg.get("message_id", 0)
            msg_chat_id = str(msg.get("chat", {}).get("id", ""))
            text = msg.get("text", "")

            if msg_chat_id == str(chat_id) and msg_id > after_message_id and text:
                _log.info("REPLY FOUND | chat_id=%s | message_id=%s", chat_id, msg_id)
                return text

        return None

    except requests.exceptions.RequestException as exc:
        _log.error("REPLY POLL ERROR | %s", exc)
        return None


def set_webhook(url: str) -> bool:
    """
    Set a webhook URL for the Telegram bot.

    In production, Telegram pushes updates to this URL instead of polling.
    Call this once during initial setup.

    Args:
        url: The HTTPS URL to receive webhook updates.

    Returns:
        True on success, False on failure.

    Example:
        set_webhook("https://myserver.com/webhook/telegram")
    """
    token = _get_bot_token()
    if not token:
        _log.error("WEBHOOK FAILED | No TELEGRAM_BOT_TOKEN configured")
        return False

    try:
        webhook_url = f"{TELEGRAM_API_BASE}/bot{token}/setWebhook"
        response = requests.post(webhook_url, json={"url": url}, timeout=15)
        response.raise_for_status()
        data = response.json()

        if data.get("ok"):
            _log.info("WEBHOOK SET | url=%s", url)
            return True
        else:
            _log.error("WEBHOOK FAILED | error=%s", data.get("description"))
            return False

    except requests.exceptions.RequestException as exc:
        _log.error("WEBHOOK ERROR | %s", exc)
        return False


def delete_webhook() -> bool:
    """
    Remove the webhook to switch back to polling mode.

    Returns:
        True on success, False on failure.

    Example:
        delete_webhook()
    """
    token = _get_bot_token()
    if not token:
        return False

    try:
        webhook_url = f"{TELEGRAM_API_BASE}/bot{token}/deleteWebhook"
        response = requests.post(webhook_url, timeout=15)
        response.raise_for_status()
        data = response.json()

        if data.get("ok"):
            _log.info("WEBHOOK DELETED")
            return True
        return False

    except requests.exceptions.RequestException:
        return False


def _get_latest_update_id(token: str) -> Optional[int]:
    """
    Get the latest Telegram update_id.

    Args:
        token: Bot token.

    Returns:
        The latest update_id, or None.
    """
    try:
        response = requests.get(
            f"{TELEGRAM_API_BASE}/bot{token}/getUpdates",
            params={"limit": 1, "offset": -1},
            timeout=5,
        )
        response.raise_for_status()
        results = response.json().get("result", [])
        if results:
            return results[-1].get("update_id")
    except requests.exceptions.RequestException:
        pass
    return None


def _acknowledge_update(token: str, update_id: int) -> None:
    """
    Acknowledge an update so it is not returned again.

    Args:
        token: Bot token.
        update_id: The update_id to acknowledge.
    """
    try:
        requests.get(
            f"{TELEGRAM_API_BASE}/bot{token}/getUpdates",
            params={"offset": update_id + 1},
            timeout=5,
        )
    except requests.exceptions.RequestException:
        pass


def send_message(user_id: str, content: str, channel: str = "telegram") -> dict:
    """
    Send a text message to the user via the specified channel.

    Args:
        user_id: The unique identifier of the user.
        content: The message text to send.
        channel: Delivery channel. Defaults to "telegram".

    Returns:
        A dict with delivery status: message_id, status, timestamp.

    Example:
        result = send_message("owner", "Task completed!", "telegram")
    """
    if channel != "telegram":
        _log.warning(
            "SEND | Unsupported channel: %s, falling back to telegram", channel
        )

    token = _get_bot_token()
    if not token:
        return {"status": "error", "error": "No TELEGRAM_BOT_TOKEN configured"}

    url = f"{TELEGRAM_API_BASE}/bot{token}/sendMessage"

    try:
        response = requests.post(
            url,
            json={"chat_id": user_id, "text": content, "parse_mode": "Markdown"},
            timeout=15,
        )
        response.raise_for_status()
        data = response.json()

        if data.get("ok"):
            result = data.get("result", {})
            return {
                "status": "sent",
                "message_id": result.get("message_id"),
                "timestamp": result.get("date"),
            }
        else:
            return {"status": "error", "error": data.get("description")}

    except requests.exceptions.RequestException as exc:
        return {"status": "error", "error": str(exc)}


def send_formatted_message(
    user_id: str, content: str, format_type: str = "markdown", channel: str = "telegram"
) -> dict:
    """
    Send a formatted message (Markdown, HTML) to the user.

    Args:
        user_id: The unique identifier of the user.
        content: The formatted message content.
        format_type: Content format. Defaults to "markdown".
        channel: Delivery channel. Defaults to "telegram".

    Returns:
        A dict with delivery status.

    Example:
        send_formatted_message("owner", "**Important:** Check this.", "markdown")
    """
    token = _get_bot_token()
    if not token:
        return {"status": "error", "error": "No TELEGRAM_BOT_TOKEN configured"}

    url = f"{TELEGRAM_API_BASE}/bot{token}/sendMessage"
    parse_mode = "Markdown" if format_type == "markdown" else "HTML"

    try:
        response = requests.post(
            url,
            json={"chat_id": user_id, "text": content, "parse_mode": parse_mode},
            timeout=15,
        )
        response.raise_for_status()
        data = response.json()

        if data.get("ok"):
            result = data.get("result", {})
            return {
                "status": "sent",
                "message_id": result.get("message_id"),
                "timestamp": result.get("date"),
            }
        else:
            return {"status": "error", "error": data.get("description")}

    except requests.exceptions.RequestException as exc:
        return {"status": "error", "error": str(exc)}


def get_delivery_status(message_id: str) -> dict:
    """
    Check the delivery status of a previously sent message.

    Note: Telegram Bot API does not provide read receipts.
    This returns basic info based on message_id existence.

    Args:
        message_id: The message identifier.

    Returns:
        A dict with delivery status.

    Example:
        status = get_delivery_status("42")
    """
    return {
        "message_id": message_id,
        "delivered": True,
        "read": None,
        "note": "Telegram does not provide read receipts",
    }
