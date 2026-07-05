import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import auth
from ..db import get_db
from ..events import record_event
from ..models import LibraryItem, MovieNightSession, WatchlistItem
from ..ws import hub

router = APIRouter(prefix="/api/session", tags=["session"], dependencies=[Depends(auth.require_auth)])


def _now() -> datetime:
    return datetime.now(timezone.utc)


# Valid host-driven / system-driven state transitions. "picking" -> "queued" is
# set exclusively by POST /queue (not /advance); ended is only set by /end.
_ALLOWED_ADVANCE = {
    "queued": {"playing"},
    "playing": {"rating"},
}


def _active_session(db: Session) -> MovieNightSession | None:
    return (
        db.query(MovieNightSession)
        .filter(MovieNightSession.state != "ended")
        .order_by(MovieNightSession.id.desc())
        .first()
    )


def _session_dict(db: Session, session: MovieNightSession) -> dict:
    out = session.to_dict()
    if session.watchlist_item_id:
        item = db.get(WatchlistItem, session.watchlist_item_id)
        if item:
            out["watchlist_item_title"] = item.title
            out["watchlist_item_poster"] = item.poster
    if session.library_item_id:
        lib = db.get(LibraryItem, session.library_item_id)
        if lib:
            out["library_item_title"] = lib.display_title()
            out["library_path"] = lib.path
    out["needs_download"] = bool(session.watchlist_item_id and not session.library_item_id)
    return out


def _sync_pick_link(db: Session, session: MovieNightSession) -> bool:
    """Re-check whether the session's picked watchlist item has since been
    linked to a library file (e.g. via a TorBox download that completed and
    auto-linked). Returns True if the session was updated."""
    if not session.watchlist_item_id or session.library_item_id:
        return False
    item = db.get(WatchlistItem, session.watchlist_item_id)
    if not item or not item.library_item_id:
        return False
    session.library_item_id = item.library_item_id
    db.commit()
    db.refresh(session)
    return True


async def _broadcast(db: Session, session: MovieNightSession) -> None:
    await hub.broadcast("session_update", _session_dict(db, session))


class StartBody(BaseModel):
    group_id: int | None = None


class PickBody(BaseModel):
    watchlist_item_id: int


class AdvanceBody(BaseModel):
    state: str


@router.get("/current")
async def get_current(db: Session = Depends(get_db)):
    session = _active_session(db)
    if not session:
        return {"active": None}
    if _sync_pick_link(db, session):
        await _broadcast(db, session)
    return {"active": _session_dict(db, session)}


@router.post("/start")
async def start_session(
    body: StartBody,
    db: Session = Depends(get_db),
    user: auth.CurrentUser = Depends(auth.require_auth),
):
    if _active_session(db):
        raise HTTPException(409, "A movie night session is already active")
    if body.group_id is not None:
        from ..models import WatchlistGroup

        if not db.get(WatchlistGroup, body.group_id):
            raise HTTPException(400, "Invalid group_id")
    session = MovieNightSession(
        group_id=body.group_id,
        state="picking",
        started_by_user_id=user.id,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    record_event("session_started", "Movie night session", user=user)
    await _broadcast(db, session)
    return _session_dict(db, session)


@router.post("/pick")
async def pick_item(
    body: PickBody,
    db: Session = Depends(get_db),
    user: auth.CurrentUser = Depends(auth.require_auth),
):
    session = _active_session(db)
    if not session:
        raise HTTPException(404, "No active session")
    item = db.get(WatchlistItem, body.watchlist_item_id)
    if not item:
        raise HTTPException(404, "Watchlist item not found")

    session.watchlist_item_id = item.id
    session.library_item_id = item.library_item_id
    db.commit()
    db.refresh(session)
    record_event("session_pick", item.title or "Untitled", user=user)
    await _broadcast(db, session)
    return _session_dict(db, session)


@router.post("/queue")
async def queue_pick(
    db: Session = Depends(get_db),
    user: auth.CurrentUser = Depends(auth.require_auth),
):
    from ..playqueue.manager import manager

    session = _active_session(db)
    if not session:
        raise HTTPException(404, "No active session")
    _sync_pick_link(db, session)
    if not session.library_item_id:
        raise HTTPException(400, "No pick to queue yet")

    lib = db.get(LibraryItem, session.library_item_id)
    if not lib:
        raise HTTPException(404, "Linked library item no longer exists")

    try:
        snap = await manager.add_library_item(session.library_item_id, user=user)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc

    session.state = "queued"
    db.commit()
    db.refresh(session)
    await _broadcast(db, session)

    # Fire-and-forget prepare (plan 013) for the queue item we just added —
    # it's the newest item with a matching library_path.
    queued_item = next(
        (i for i in reversed(snap["items"]) if i.get("library_path") == lib.path), None
    )
    if queued_item:
        asyncio.create_task(manager.prepare_item(queued_item["id"]))

    return _session_dict(db, session)


@router.post("/advance")
async def advance_session(
    body: AdvanceBody,
    db: Session = Depends(get_db),
    user: auth.CurrentUser = Depends(auth.require_auth),
):
    session = _active_session(db)
    if not session:
        raise HTTPException(404, "No active session")
    allowed = _ALLOWED_ADVANCE.get(session.state, set())
    if body.state not in allowed:
        raise HTTPException(400, f"Cannot advance from {session.state} to {body.state}")
    session.state = body.state
    db.commit()
    db.refresh(session)
    await _broadcast(db, session)
    return _session_dict(db, session)


@router.post("/end")
async def end_session(
    db: Session = Depends(get_db),
    user: auth.CurrentUser = Depends(auth.require_auth),
):
    session = _active_session(db)
    if not session:
        raise HTTPException(404, "No active session")
    session.state = "ended"
    session.ended_at = _now()
    db.commit()
    db.refresh(session)
    record_event("session_ended", "Movie night session", user=user)
    await _broadcast(db, session)
    return _session_dict(db, session)
