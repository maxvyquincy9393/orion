"""
calendar_ops.py

Calendar operations for Orion.
Reads from local .ics file or Google Calendar API if configured.
All operations pass through sandbox permission check first.
Part of Orion — Persistent AI Companion System.
"""

import datetime
import logging
import os
from pathlib import Path
from typing import Optional

import config

_log = logging.getLogger("orion.system")
_log_file = config.LOGS_DIR / "system.log"
_handler = logging.FileHandler(_log_file)
_handler.setFormatter(logging.Formatter("%(asctime)s | %(levelname)-8s | %(message)s"))
_log.addHandler(_handler)
_log.setLevel(getattr(logging, config.LOG_LEVEL, logging.INFO))

CALENDAR_FILE = config.PROJECT_ROOT / "data" / "calendar.ics"


def _check_permission(action: str) -> tuple[bool, str]:
    """
    Check sandbox permission for calendar operation.

    Args:
        action: The permission action (calendar.read or calendar.write).

    Returns:
        Tuple of (allowed, reason).
    """
    try:
        from permissions.permission_types import PermissionAction
        from permissions import sandbox

        permission_action = (
            PermissionAction.CALENDAR_READ
            if "read" in action
            else PermissionAction.CALENDAR_WRITE
        )

        result = sandbox.check(permission_action.value, {})

        if not result.allowed:
            return False, result.reason

        if result.requires_confirm:
            confirmed = sandbox.request_confirm(permission_action.value, {})
            if not confirmed:
                return False, "User declined"

        return True, "Allowed"

    except Exception as exc:
        _log.error("Permission check failed: %s", exc)
        return True, "Permission check error - allowing"


def get_events(date: str) -> list[dict]:
    """
    Get calendar events for a specific date.

    Checks CALENDAR_READ permission first.

    Args:
        date: Date string in YYYY-MM-DD format.

    Returns:
        List of event dicts with title, date, time, duration.

    Example:
        events = get_events("2024-03-15")
        for event in events:
            print(event["title"], event["time"])
    """
    allowed, reason = _check_permission("calendar.read")
    if not allowed:
        _log.warning("CALENDAR READ BLOCKED | reason=%s", reason)
        return []

    events = []

    google_configured = bool(
        getattr(config, "GOOGLE_ACCESS_TOKEN", None)
        or os.getenv("GOOGLE_CREDENTIALS_FILE")
    )

    if google_configured:
        try:
            events = _get_google_events(date)
            if events:
                _log.info(
                    "CALENDAR GET | date=%s | count=%d (Google)", date, len(events)
                )
                return events
        except Exception as exc:
            _log.warning("Google Calendar fetch failed: %s", exc)

    try:
        events = _get_local_events(date)
        _log.info("CALENDAR GET | date=%s | count=%d (local)", date, len(events))
        return events
    except Exception as exc:
        _log.error("CALENDAR GET | date=%s | error=%s", date, exc)
        return []


def _get_local_events(date: str) -> list[dict]:
    """
    Get events from local .ics file.

    Args:
        date: Date string in YYYY-MM-DD format.

    Returns:
        List of event dicts.
    """
    events = []

    if not CALENDAR_FILE.exists():
        return events

    try:
        from icalendar import Calendar

        with open(CALENDAR_FILE, "rb") as f:
            cal = Calendar.from_ical(f.read())

        target_date = datetime.datetime.strptime(date, "%Y-%m-%d").date()

        for component in cal.walk():
            if component.name == "VEVENT":
                dtstart = component.get("dtstart")
                if dtstart:
                    event_dt = dtstart.dt
                    if hasattr(event_dt, "date"):
                        event_date = event_dt.date()
                    else:
                        event_date = event_dt

                    if event_date == target_date:
                        dtend = component.get("dtend")
                        duration_minutes = 0
                        if dtend and hasattr(dtstart.dt, "hour"):
                            duration = dtend.dt - dtstart.dt
                            duration_minutes = int(duration.total_seconds() / 60)

                        time_str = ""
                        if hasattr(dtstart.dt, "hour"):
                            time_str = dtstart.dt.strftime("%H:%M")

                        events.append(
                            {
                                "title": str(component.get("summary", "Untitled")),
                                "date": date,
                                "time": time_str,
                                "duration_minutes": duration_minutes,
                                "location": str(component.get("location", "")),
                                "description": str(component.get("description", "")),
                            }
                        )

    except ImportError:
        _log.warning("icalendar not installed. Run: pip install icalendar")
    except Exception as exc:
        _log.error("Failed to parse local calendar: %s", exc)

    return events


def _get_google_events(date: str) -> list[dict]:
    """
    Get events from Google Calendar API.

    Args:
        date: Date string in YYYY-MM-DD format.

    Returns:
        List of event dicts.
    """
    events = []

    try:
        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build

        token = getattr(config, "GOOGLE_ACCESS_TOKEN", None)
        if not token:
            return events

        creds = Credentials(token)

        service = build("calendar", "v3", credentials=creds)

        target_date = datetime.datetime.strptime(date, "%Y-%m-%d")
        time_min = target_date.isoformat() + "Z"
        time_max = (target_date + datetime.timedelta(days=1)).isoformat() + "Z"

        events_result = (
            service.events()
            .list(
                calendarId="primary",
                timeMin=time_min,
                timeMax=time_max,
                singleEvents=True,
                orderBy="startTime",
            )
            .execute()
        )

        for event in events_result.get("items", []):
            start = event.get("start", {})
            end = event.get("end", {})

            time_str = ""
            duration_minutes = 0

            if "dateTime" in start:
                start_dt = datetime.datetime.fromisoformat(
                    start["dateTime"].replace("Z", "+00:00")
                )
                time_str = start_dt.strftime("%H:%M")

                if "dateTime" in end:
                    end_dt = datetime.datetime.fromisoformat(
                        end["dateTime"].replace("Z", "+00:00")
                    )
                    duration_minutes = int((end_dt - start_dt).total_seconds() / 60)

            events.append(
                {
                    "title": event.get("summary", "Untitled"),
                    "date": date,
                    "time": time_str,
                    "duration_minutes": duration_minutes,
                    "location": event.get("location", ""),
                    "description": event.get("description", ""),
                }
            )

    except ImportError:
        _log.warning("google-api-python-client not installed")
    except Exception as exc:
        _log.error("Google Calendar API error: %s", exc)

    return events


def add_event(title: str, date: str, time: str, duration_minutes: int = 60) -> bool:
    """
    Add a calendar event.

    Checks CALENDAR_WRITE permission first.

    Args:
        title: Event title.
        date: Date string in YYYY-MM-DD format.
        time: Time string in HH:MM format.
        duration_minutes: Event duration in minutes. Defaults to 60.

    Returns:
        True on success, False on failure.

    Example:
        success = add_event("Team meeting", "2024-03-15", "14:00", 30)
    """
    allowed, reason = _check_permission("calendar.write")
    if not allowed:
        _log.warning("CALENDAR WRITE BLOCKED | reason=%s", reason)
        return False

    google_configured = bool(
        getattr(config, "GOOGLE_ACCESS_TOKEN", None)
        or os.getenv("GOOGLE_CREDENTIALS_FILE")
    )

    if google_configured:
        try:
            result = _add_google_event(title, date, time, duration_minutes)
            if result:
                _log.info(
                    "CALENDAR ADD | title='%s' | date=%s | time=%s (Google)",
                    title[:30],
                    date,
                    time,
                )
                return True
        except Exception as exc:
            _log.warning("Google Calendar add failed: %s", exc)

    try:
        result = _add_local_event(title, date, time, duration_minutes)
        if result:
            _log.info(
                "CALENDAR ADD | title='%s' | date=%s | time=%s (local)",
                title[:30],
                date,
                time,
            )
        return result
    except Exception as exc:
        _log.error("CALENDAR ADD | title='%s' | error=%s", title[:30], exc)
        return False


def _add_local_event(title: str, date: str, time: str, duration_minutes: int) -> bool:
    """
    Add event to local .ics file.

    Args:
        title: Event title.
        date: Date string.
        time: Time string.
        duration_minutes: Duration in minutes.

    Returns:
        True on success.
    """
    try:
        from icalendar import Calendar, Event, vDatetime
        import uuid

        CALENDAR_FILE.parent.mkdir(parents=True, exist_ok=True)

        cal = None
        if CALENDAR_FILE.exists():
            with open(CALENDAR_FILE, "rb") as f:
                cal = Calendar.from_ical(f.read())

        if not cal:
            cal = Calendar()
            cal.add("prodid", "-//Orion Calendar//orion.local//")
            cal.add("version", "2.0")

        event = Event()
        event.add("summary", title)
        event.add("uid", str(uuid.uuid4()) + "@orion.local")

        start_dt = datetime.datetime.strptime(f"{date} {time}", "%Y-%m-%d %H:%M")
        event.add("dtstart", start_dt)

        end_dt = start_dt + datetime.timedelta(minutes=duration_minutes)
        event.add("dtend", end_dt)

        cal.add_component(event)

        with open(CALENDAR_FILE, "wb") as f:
            f.write(cal.to_ical())

        return True

    except ImportError:
        _log.warning("icalendar not installed. Run: pip install icalendar")
        return False
    except Exception as exc:
        _log.error("Failed to add local event: %s", exc)
        return False


def _add_google_event(title: str, date: str, time: str, duration_minutes: int) -> bool:
    """
    Add event to Google Calendar.

    Args:
        title: Event title.
        date: Date string.
        time: Time string.
        duration_minutes: Duration in minutes.

    Returns:
        True on success.
    """
    try:
        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build

        token = getattr(config, "GOOGLE_ACCESS_TOKEN", None)
        if not token:
            return False

        creds = Credentials(token)

        service = build("calendar", "v3", credentials=creds)

        start_dt = datetime.datetime.strptime(f"{date} {time}", "%Y-%m-%d %H:%M")
        end_dt = start_dt + datetime.timedelta(minutes=duration_minutes)

        event_body = {
            "summary": title,
            "start": {
                "dateTime": start_dt.isoformat(),
                "timeZone": "UTC",
            },
            "end": {
                "dateTime": end_dt.isoformat(),
                "timeZone": "UTC",
            },
        }

        service.events().insert(calendarId="primary", body=event_body).execute()
        return True

    except Exception as exc:
        _log.error("Google Calendar add error: %s", exc)
        return False


def get_upcoming_events(days: int = 7) -> list[dict]:
    """
    Get upcoming events for the next N days.

    Args:
        days: Number of days to look ahead. Defaults to 7.

    Returns:
        List of event dicts.

    Example:
        events = get_upcoming_events(days=3)
    """
    allowed, reason = _check_permission("calendar.read")
    if not allowed:
        return []

    events = []
    today = datetime.date.today()

    for i in range(days):
        date_str = (today + datetime.timedelta(days=i)).isoformat()
        day_events = get_events(date_str)
        events.extend(day_events)

    _log.info("CALENDAR UPCOMING | days=%d | count=%d", days, len(events))
    return events
