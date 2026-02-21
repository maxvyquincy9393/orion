"""
oauth_openai.py

OpenAI/Codex OAuth device-code authentication flow for Orion.
Stores and refreshes tokens under .orion/auth/openai.json.
Part of Orion - Persistent AI Companion System.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import time
import webbrowser
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode

import requests

PROJECT_ROOT = Path(__file__).resolve().parents[2]
AUTH_DIR = PROJECT_ROOT / ".orion" / "auth"
AUTH_FILE = AUTH_DIR / "openai.json"
LOGS_DIR = PROJECT_ROOT / "logs"
LOG_FILE = LOGS_DIR / "auth.log"

OPENAI_ISSUER = os.getenv("OPENAI_OAUTH_ISSUER", "https://auth.openai.com").rstrip("/")
OPENAI_CLIENT_ID = os.getenv(
    "OPENAI_OAUTH_CLIENT_ID",
    "app_EMoamEEZ73f0CkXaXp7hrann",
)
OPENAI_DEVICE_USERCODE_URL = f"{OPENAI_ISSUER}/api/accounts/deviceauth/usercode"
OPENAI_DEVICE_TOKEN_URL = f"{OPENAI_ISSUER}/api/accounts/deviceauth/token"
OPENAI_VERIFICATION_URL = f"{OPENAI_ISSUER}/codex/device"
OPENAI_TOKEN_URL = f"{OPENAI_ISSUER}/oauth/token"
OPENAI_DEVICE_REDIRECT_URI = f"{OPENAI_ISSUER}/deviceauth/callback"

REFRESH_BUFFER = timedelta(hours=1)
DEFAULT_DEVICE_TIMEOUT_SECONDS = 15 * 60
DEFAULT_DEVICE_INTERVAL_SECONDS = 5

LOGS_DIR.mkdir(parents=True, exist_ok=True)

_log = logging.getLogger("orion.auth.openai")
if not _log.handlers:
    _handler = logging.FileHandler(LOG_FILE, encoding="utf-8")
    _handler.setFormatter(
        logging.Formatter("[%(asctime)s] [%(levelname)s] [auth.openai] %(message)s")
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


def _decode_token_expiry(access_token: str) -> datetime | None:
    """Best-effort decode of JWT exp claim from an access token."""
    if not access_token or access_token.count(".") < 2:
        return None

    try:
        payload_b64 = access_token.split(".")[1]
        payload_b64 += "=" * (-len(payload_b64) % 4)
        decoded = base64.urlsafe_b64decode(payload_b64.encode("utf-8"))
        payload = json.loads(decoded.decode("utf-8"))
        exp = payload.get("exp")
        if isinstance(exp, (int, float)):
            return datetime.fromtimestamp(float(exp), tz=timezone.utc)
    except Exception:
        return None

    return None


def _resolve_expiry(access_token: str, token_payload: dict) -> datetime:
    """Resolve token expiry from expires_in or token claims with a safe fallback."""
    expires_in = token_payload.get("expires_in")
    if isinstance(expires_in, (int, float)):
        return _utc_now() + timedelta(seconds=int(expires_in))

    decoded_expiry = _decode_token_expiry(access_token)
    if decoded_expiry:
        return decoded_expiry

    return _utc_now() + timedelta(hours=1)


def _read_auth_data() -> dict | None:
    """Read OpenAI auth payload from disk."""
    if not AUTH_FILE.exists():
        return None

    try:
        return json.loads(AUTH_FILE.read_text(encoding="utf-8"))
    except Exception as exc:
        _log.error("Failed to read OpenAI auth file: %s", exc)
        return None


def _write_auth_data(
    access_token: str,
    refresh_token: str,
    expires_at: datetime,
) -> None:
    """Persist OpenAI auth payload to disk."""
    AUTH_DIR.mkdir(parents=True, exist_ok=True)

    payload = {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "expires_at": _iso_utc(expires_at),
        "provider": "openai",
    }

    AUTH_FILE.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _token_is_expired(expires_at: str) -> bool:
    """Return True if the token expiry is in the past or invalid."""
    expiry = _parse_iso_datetime(expires_at)
    if not expiry:
        return True
    return expiry <= _utc_now()


def _token_expires_soon(expires_at: str) -> bool:
    """Return True if token expires within the refresh buffer window."""
    expiry = _parse_iso_datetime(expires_at)
    if not expiry:
        return True
    return expiry <= (_utc_now() + REFRESH_BUFFER)


def _request_device_code() -> dict | None:
    """Request OpenAI device code and user code."""
    payload = {"client_id": OPENAI_CLIENT_ID}

    try:
        response = requests.post(
            OPENAI_DEVICE_USERCODE_URL,
            headers={"Content-Type": "application/json"},
            json=payload,
            timeout=30,
        )
    except requests.RequestException as exc:
        _log.error("OpenAI device code request failed: %s", exc)
        return None

    if not response.ok:
        _log.error(
            "OpenAI device code request rejected (%s): %s",
            response.status_code,
            response.text,
        )
        return None

    try:
        return response.json()
    except ValueError as exc:
        _log.error("Invalid OpenAI device code response: %s", exc)
        return None


def _poll_for_authorization_code(
    device_auth_id: str,
    user_code: str,
    interval_seconds: int,
) -> dict | None:
    """Poll OpenAI device auth endpoint until an authorization code is issued."""
    timeout_seconds = int(
        os.getenv("OPENAI_OAUTH_DEVICE_TIMEOUT_SECONDS", DEFAULT_DEVICE_TIMEOUT_SECONDS)
    )
    interval = max(1, interval_seconds)

    started_at = _utc_now()
    deadline = started_at + timedelta(seconds=timeout_seconds)

    while _utc_now() < deadline:
        try:
            response = requests.post(
                OPENAI_DEVICE_TOKEN_URL,
                headers={"Content-Type": "application/json"},
                json={"device_auth_id": device_auth_id, "user_code": user_code},
                timeout=30,
            )
        except requests.RequestException as exc:
            _log.warning("OpenAI device token poll request failed: %s", exc)
            time.sleep(interval)
            continue

        if response.ok:
            try:
                return response.json()
            except ValueError as exc:
                _log.error("Invalid OpenAI poll response: %s", exc)
                return None

        if response.status_code in (403, 404):
            time.sleep(interval)
            continue

        if response.status_code == 429:
            interval = min(interval + 2, 30)
            time.sleep(interval)
            continue

        _log.error(
            "OpenAI device token poll failed (%s): %s",
            response.status_code,
            response.text,
        )
        return None

    _log.warning("OpenAI device-code login timed out")
    return None


def _exchange_authorization_code(
    authorization_code: str,
    code_verifier: str,
) -> dict | None:
    """Exchange authorization code for OpenAI OAuth access and refresh tokens."""
    body = urlencode(
        {
            "grant_type": "authorization_code",
            "code": authorization_code,
            "redirect_uri": OPENAI_DEVICE_REDIRECT_URI,
            "client_id": OPENAI_CLIENT_ID,
            "code_verifier": code_verifier,
        }
    )

    try:
        response = requests.post(
            OPENAI_TOKEN_URL,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            data=body,
            timeout=30,
        )
    except requests.RequestException as exc:
        _log.error("OpenAI token exchange request failed: %s", exc)
        return None

    if not response.ok:
        _log.error(
            "OpenAI token exchange failed (%s): %s",
            response.status_code,
            response.text,
        )
        return None

    try:
        return response.json()
    except ValueError as exc:
        _log.error("Invalid OpenAI token exchange response: %s", exc)
        return None


def login() -> str | None:
    """
    Run OpenAI/Codex OAuth device-code login flow.

    Returns:
        Access token if login succeeds, otherwise None.
    """
    _log.info("Starting OpenAI device-code login")

    device_code_payload = _request_device_code()
    if not device_code_payload:
        _log.error("OpenAI device-code login failed while requesting user code")
        return None

    user_code = str(device_code_payload.get("user_code") or "").strip()
    device_auth_id = str(device_code_payload.get("device_auth_id") or "").strip()
    interval_raw = device_code_payload.get("interval", DEFAULT_DEVICE_INTERVAL_SECONDS)

    try:
        interval = int(interval_raw)
    except (TypeError, ValueError):
        interval = DEFAULT_DEVICE_INTERVAL_SECONDS

    if not user_code or not device_auth_id:
        _log.error("OpenAI device-code payload missing user_code or device_auth_id")
        return None

    print("OpenAI login required.")
    print(f"Open this URL in your browser: {OPENAI_VERIFICATION_URL}")
    print(f"Enter this code: {user_code}")

    opened = webbrowser.open(OPENAI_VERIFICATION_URL)
    if opened:
        _log.info("Opened browser for OpenAI device login")
    else:
        _log.info("Could not open browser automatically for OpenAI login")

    poll_result = _poll_for_authorization_code(device_auth_id, user_code, interval)
    if not poll_result:
        _log.error("OpenAI device-code login failed during polling")
        return None

    authorization_code = str(poll_result.get("authorization_code") or "").strip()
    code_verifier = str(poll_result.get("code_verifier") or "").strip()

    if not authorization_code or not code_verifier:
        _log.error("OpenAI poll response missing authorization_code or code_verifier")
        return None

    token_payload = _exchange_authorization_code(authorization_code, code_verifier)
    if not token_payload:
        _log.error("OpenAI device-code login failed during token exchange")
        return None

    access_token = str(token_payload.get("access_token") or "").strip()
    refresh_token = str(token_payload.get("refresh_token") or "").strip()

    if not access_token or not refresh_token:
        _log.error("OpenAI token exchange returned incomplete credentials")
        return None

    expires_at = _resolve_expiry(access_token, token_payload)
    _write_auth_data(access_token, refresh_token, expires_at)

    _log.info("OpenAI login complete; credentials saved to %s", AUTH_FILE)
    return access_token


def refresh() -> str | None:
    """
    Refresh OpenAI OAuth access token when expiry is near.

    Returns:
        A valid access token, or None if refresh is not possible.
    """
    data = _read_auth_data()
    if not data:
        _log.info("OpenAI refresh skipped: no stored credentials")
        return None

    access_token = str(data.get("access_token") or "").strip()
    refresh_token = str(data.get("refresh_token") or "").strip()
    expires_at = str(data.get("expires_at") or "").strip()

    if access_token and not _token_expires_soon(expires_at):
        return access_token

    if not refresh_token:
        _log.warning("OpenAI refresh skipped: refresh_token missing")
        return None

    payload = {
        "client_id": OPENAI_CLIENT_ID,
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "scope": "openid profile email",
    }

    try:
        response = requests.post(
            OPENAI_TOKEN_URL,
            headers={"Content-Type": "application/json"},
            json=payload,
            timeout=30,
        )
    except requests.RequestException as exc:
        _log.error("OpenAI refresh request failed: %s", exc)
        return None

    if not response.ok:
        _log.error(
            "OpenAI refresh failed (%s): %s",
            response.status_code,
            response.text,
        )
        return None

    try:
        refreshed_payload = response.json()
    except ValueError as exc:
        _log.error("Invalid OpenAI refresh response: %s", exc)
        return None

    new_access_token = str(
        refreshed_payload.get("access_token") or access_token
    ).strip()
    new_refresh_token = str(
        refreshed_payload.get("refresh_token") or refresh_token
    ).strip()

    if not new_access_token or not new_refresh_token:
        _log.error("OpenAI refresh returned incomplete tokens")
        return None

    new_expires_at = _resolve_expiry(new_access_token, refreshed_payload)
    _write_auth_data(new_access_token, new_refresh_token, new_expires_at)

    _log.info("OpenAI access token refreshed")
    return new_access_token


def get_token() -> str | None:
    """
    Get a valid OpenAI access token.

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
    """Remove stored OpenAI OAuth credentials."""
    if AUTH_FILE.exists():
        AUTH_FILE.unlink()
        _log.info("OpenAI credentials deleted")
    else:
        _log.info("OpenAI logout called with no stored credentials")


def is_logged_in() -> bool:
    """
    Return True if OpenAI OAuth credentials exist and are not expired.

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
    Return OpenAI OAuth login status.

    Returns:
        Dict with login status and metadata.
    """
    data = _read_auth_data() or {}
    expires_at = str(data.get("expires_at") or "")
    return {
        "logged_in": is_logged_in(),
        "expires_at": expires_at,
        "provider": "openai",
    }
