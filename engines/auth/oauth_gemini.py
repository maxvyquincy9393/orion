"""
oauth_gemini.py

Google Gemini OAuth device-code authentication flow for Orion.
Stores and refreshes tokens under .orion/auth/gemini.json.
Part of Orion - Persistent AI Companion System.
"""

from __future__ import annotations

import json
import logging
import os
import time
import webbrowser
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

PROJECT_ROOT = Path(__file__).resolve().parents[2]
AUTH_DIR = PROJECT_ROOT / ".orion" / "auth"
AUTH_FILE = AUTH_DIR / "gemini.json"
LOGS_DIR = PROJECT_ROOT / "logs"
LOG_FILE = LOGS_DIR / "auth.log"

GOOGLE_DEVICE_CODE_URL = "https://oauth2.googleapis.com/device/code"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_SCOPE = "https://www.googleapis.com/auth/generative-language"
GOOGLE_DEFAULT_CLIENT_ID = (
    "681255809395-oe1ai0bih85l6aq4sksepfq7s4bpfkvq.apps.googleusercontent.com"
)

REFRESH_BUFFER = timedelta(hours=1)
DEVICE_TIMEOUT_SECONDS = 5 * 60
DEFAULT_POLL_INTERVAL_SECONDS = 5

LOGS_DIR.mkdir(parents=True, exist_ok=True)

_log = logging.getLogger("orion.auth.gemini")
if not _log.handlers:
    _handler = logging.FileHandler(LOG_FILE, encoding="utf-8")
    _handler.setFormatter(
        logging.Formatter("[%(asctime)s] [%(levelname)s] [auth.gemini] %(message)s")
    )
    _log.addHandler(_handler)
    _log.setLevel(logging.INFO)
    _log.propagate = False


def _utc_now() -> datetime:
    """Return the current UTC datetime."""
    return datetime.now(timezone.utc)


def _parse_iso_datetime(value: str) -> datetime | None:
    """Parse an ISO-8601 timestamp string to an aware UTC datetime."""
    if not value:
        return None

    normalized = value.strip()
    if normalized.endswith("Z"):
        normalized = f"{normalized[:-1]}+00:00"

    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)

    return parsed.astimezone(timezone.utc)


def _iso_utc(value: datetime) -> str:
    """Format an aware datetime as an ISO UTC string."""
    return value.astimezone(timezone.utc).isoformat()


def _token_is_expired(expires_at: str) -> bool:
    """Return True if token expiry is missing, invalid, or in the past."""
    expiry = _parse_iso_datetime(expires_at)
    if not expiry:
        return True
    return expiry <= _utc_now()


def _token_expires_soon(expires_at: str) -> bool:
    """Return True if token expiry is within the refresh buffer window."""
    expiry = _parse_iso_datetime(expires_at)
    if not expiry:
        return True
    return expiry <= (_utc_now() + REFRESH_BUFFER)


def _client_id() -> str:
    """Resolve Google OAuth client ID from env or default public Gemini client."""
    return (
        os.getenv("GOOGLE_OAUTH_CLIENT_ID", "").strip() or GOOGLE_DEFAULT_CLIENT_ID
    )


def _client_secret() -> str:
    """Resolve optional Google OAuth client secret from env."""
    return os.getenv("GOOGLE_OAUTH_CLIENT_SECRET", "").strip()


def _read_auth_data() -> dict | None:
    """Read Gemini auth payload from disk."""
    if not AUTH_FILE.exists():
        return None

    try:
        return json.loads(AUTH_FILE.read_text(encoding="utf-8"))
    except Exception as exc:
        _log.error("Failed to read Gemini auth file: %s", exc)
        return None


def _write_auth_data(access_token: str, refresh_token: str, expires_at: datetime) -> None:
    """Persist Gemini auth payload to disk."""
    AUTH_DIR.mkdir(parents=True, exist_ok=True)

    payload = {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "expires_at": _iso_utc(expires_at),
        "provider": "gemini",
    }

    AUTH_FILE.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _request_device_code() -> dict | None:
    """Request Google OAuth device code payload."""
    payload = {
        "client_id": _client_id(),
        "scope": GOOGLE_SCOPE,
    }

    try:
        response = requests.post(GOOGLE_DEVICE_CODE_URL, data=payload, timeout=30)
    except requests.RequestException as exc:
        _log.error("Gemini device code request failed: %s", exc)
        return None

    if not response.ok:
        _log.error(
            "Gemini device code request failed (%s): %s",
            response.status_code,
            response.text,
        )
        return None

    try:
        return response.json()
    except ValueError as exc:
        _log.error("Invalid Gemini device code response: %s", exc)
        return None


def _poll_for_token(device_code: str, interval_seconds: int) -> dict | None:
    """Poll Google OAuth token endpoint until login is approved or timeout."""
    interval = max(1, interval_seconds)
    deadline = _utc_now() + timedelta(seconds=DEVICE_TIMEOUT_SECONDS)

    while _utc_now() < deadline:
        payload = {
            "client_id": _client_id(),
            "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
            "device_code": device_code,
        }

        secret = _client_secret()
        if secret:
            payload["client_secret"] = secret

        try:
            response = requests.post(GOOGLE_TOKEN_URL, data=payload, timeout=30)
        except requests.RequestException as exc:
            _log.warning("Gemini token poll failed: %s", exc)
            time.sleep(interval)
            continue

        if response.ok:
            try:
                return response.json()
            except ValueError as exc:
                _log.error("Invalid Gemini token poll response: %s", exc)
                return None

        try:
            body = response.json()
            error_code = str(body.get("error") or "")
        except ValueError:
            body = {}
            error_code = ""

        if error_code == "authorization_pending":
            time.sleep(interval)
            continue

        if error_code == "slow_down":
            interval = min(interval + 2, 30)
            time.sleep(interval)
            continue

        if error_code == "access_denied":
            _log.warning("Gemini device-code login denied by user")
            return None

        _log.error(
            "Gemini token poll failed (%s): %s",
            response.status_code,
            response.text,
        )
        return None

    _log.warning("Gemini device-code login timed out after 5 minutes")
    return None


def login() -> str | None:
    """
    Run Gemini OAuth2 device-code login flow.

    Returns:
        Access token if login succeeds, otherwise None.
    """
    _log.info("Starting Gemini device-code login")

    device_payload = _request_device_code()
    if not device_payload:
        _log.error("Gemini login failed while requesting device code")
        return None

    device_code = str(device_payload.get("device_code") or "").strip()
    user_code = str(device_payload.get("user_code") or "").strip()

    verification_url = str(
        device_payload.get("verification_url")
        or device_payload.get("verification_uri")
        or ""
    ).strip()
    verification_complete = str(
        device_payload.get("verification_uri_complete") or ""
    ).strip()

    interval_raw = device_payload.get("interval", DEFAULT_POLL_INTERVAL_SECONDS)
    try:
        interval = int(interval_raw)
    except (TypeError, ValueError):
        interval = DEFAULT_POLL_INTERVAL_SECONDS

    if not device_code or not user_code or not verification_url:
        _log.error("Gemini device-code response missing required fields")
        return None

    print("Gemini login required.")
    print(f"Open this URL in your browser: {verification_url}")
    print(f"Enter this code: {user_code}")

    browser_target = verification_complete or verification_url
    opened = webbrowser.open(browser_target)
    if opened:
        _log.info("Opened browser for Gemini OAuth login")
    else:
        _log.info("Could not open browser automatically for Gemini login")

    token_payload = _poll_for_token(device_code, interval)
    if not token_payload:
        _log.error("Gemini device-code login failed during polling")
        return None

    access_token = str(token_payload.get("access_token") or "").strip()
    refresh_token = str(token_payload.get("refresh_token") or "").strip()
    expires_in = token_payload.get("expires_in", 0)

    try:
        expires_seconds = int(expires_in)
    except (TypeError, ValueError):
        expires_seconds = 3600

    if not access_token or not refresh_token:
        _log.error("Gemini token response missing access_token or refresh_token")
        return None

    expires_at = _utc_now() + timedelta(seconds=max(1, expires_seconds))
    _write_auth_data(access_token, refresh_token, expires_at)

    _log.info("Gemini login complete; credentials saved to %s", AUTH_FILE)
    return access_token


def refresh() -> str | None:
    """
    Refresh Gemini OAuth access token when expiry is near.

    Returns:
        A valid access token, or None if refresh fails.
    """
    data = _read_auth_data()
    if not data:
        _log.info("Gemini refresh skipped: no stored credentials")
        return None

    access_token = str(data.get("access_token") or "").strip()
    refresh_token = str(data.get("refresh_token") or "").strip()
    expires_at = str(data.get("expires_at") or "").strip()

    if access_token and not _token_expires_soon(expires_at):
        return access_token

    if not refresh_token:
        _log.warning("Gemini refresh skipped: refresh_token missing")
        return None

    payload = {
        "client_id": _client_id(),
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
    }

    secret = _client_secret()
    if secret:
        payload["client_secret"] = secret

    try:
        response = requests.post(GOOGLE_TOKEN_URL, data=payload, timeout=30)
    except requests.RequestException as exc:
        _log.error("Gemini refresh request failed: %s", exc)
        return None

    if not response.ok:
        _log.error(
            "Gemini refresh failed (%s): %s",
            response.status_code,
            response.text,
        )
        return None

    try:
        refreshed_payload = response.json()
    except ValueError as exc:
        _log.error("Invalid Gemini refresh response: %s", exc)
        return None

    new_access_token = str(
        refreshed_payload.get("access_token") or access_token
    ).strip()

    if not new_access_token:
        _log.error("Gemini refresh response missing access_token")
        return None

    expires_in = refreshed_payload.get("expires_in", 3600)
    try:
        expires_seconds = int(expires_in)
    except (TypeError, ValueError):
        expires_seconds = 3600

    new_expires_at = _utc_now() + timedelta(seconds=max(1, expires_seconds))
    _write_auth_data(new_access_token, refresh_token, new_expires_at)

    _log.info("Gemini access token refreshed")
    return new_access_token


def get_token() -> str | None:
    """
    Get a valid Gemini access token.

    Returns:
        Access token string, or None if user is not logged in.
    """
    data = _read_auth_data()
    if not data:
        return None

    expires_at = str(data.get("expires_at") or "").strip()
    if _token_expires_soon(expires_at):
        return refresh()

    token = str(data.get("access_token") or "").strip()
    return token or None


def logout() -> None:
    """Remove stored Gemini OAuth credentials."""
    if AUTH_FILE.exists():
        AUTH_FILE.unlink()
        _log.info("Gemini credentials deleted")
    else:
        _log.info("Gemini logout called with no stored credentials")


def is_logged_in() -> bool:
    """
    Return True if Gemini OAuth credentials exist and are not expired.

    Returns:
        Boolean login state.
    """
    data = _read_auth_data()
    if not data:
        return False

    access_token = str(data.get("access_token") or "").strip()
    expires_at = str(data.get("expires_at") or "").strip()
    return bool(access_token) and not _token_is_expired(expires_at)


def get_status() -> dict:
    """
    Return Gemini OAuth login status.

    Returns:
        Dict with login status and metadata.
    """
    data = _read_auth_data() or {}
    expires_at = str(data.get("expires_at") or "")
    return {
        "logged_in": is_logged_in(),
        "expires_at": expires_at,
        "provider": "gemini",
    }
