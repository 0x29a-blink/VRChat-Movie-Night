"""Activity feed recorder.

Writes a row to `app_events` and broadcasts it over the WS hub. Used both from
request handlers (short-lived, module-level SessionLocal) and from managers
that run outside a request (queue auto-advance, download completion, etc.).

`record_event` must never raise into its caller — an events bug must never
break queueing/downloads. Any failure is logged and swallowed.
"""

import logging

from .db import SessionLocal
from .models import AppEvent
from .ws import hub

logger = logging.getLogger(__name__)


def record_event(kind: str, title: str, detail: str = "", user=None) -> dict | None:
    """Write an AppEvent row and schedule a WS broadcast. Returns the event
    dict on success, or None if recording failed (never raises)."""
    try:
        user_id = getattr(user, "id", None)
        username = getattr(user, "username", "") or ""
        with SessionLocal() as s:
            event = AppEvent(
                user_id=user_id,
                username=username,
                kind=kind,
                title=title,
                detail=detail or "",
            )
            s.add(event)
            s.commit()
            data = event.to_dict()
        hub.broadcast_threadsafe("activity_event", data)
        return data
    except Exception:
        logger.exception("Failed to record event kind=%s title=%s", kind, title)
        return None
