"""
messenger.py

Sends messages to the user via Telegram Bot API or WhatsApp API.
Handles message formatting, delivery confirmation, and error handling.
Part of Orion — Persistent AI Companion System.
"""

from typing import Optional


def send_message(user_id: str, content: str, channel: str = "telegram") -> dict:
    """
    Send a text message to the user via the specified channel.

    Args:
        user_id: The unique identifier of the user.
        content: The message text to send.
        channel: Delivery channel — "telegram", "whatsapp", or "discord". Defaults to "telegram".

    Returns:
        A dict with delivery status: message_id, status, timestamp.

    Example:
        result = send_message("owner", "Hey! You have a pending task.", "telegram")
    """
    raise NotImplementedError


def send_formatted_message(
    user_id: str, content: str, format_type: str = "markdown", channel: str = "telegram"
) -> dict:
    """
    Send a formatted message (Markdown, HTML) to the user.

    Args:
        user_id: The unique identifier of the user.
        content: The formatted message content.
        format_type: Content format — "markdown" or "html". Defaults to "markdown".
        channel: Delivery channel. Defaults to "telegram".

    Returns:
        A dict with delivery status.

    Example:
        send_formatted_message("owner", "**Important:** Check your OAuth tokens.", "markdown")
    """
    raise NotImplementedError


def get_delivery_status(message_id: str) -> dict:
    """
    Check the delivery status of a previously sent message.

    Args:
        message_id: The unique identifier of the sent message.

    Returns:
        A dict with delivery status: delivered, read, timestamp.

    Example:
        status = get_delivery_status("msg_123")
    """
    raise NotImplementedError
