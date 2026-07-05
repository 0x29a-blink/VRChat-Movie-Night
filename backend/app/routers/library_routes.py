import asyncio
import os
import re
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from .. import auth
from ..db import SessionLocal, get_db
from ..events import record_event
from ..library.linking import apply_tmdb_link, sync_queue_from_library, sync_watchlist_from_library
from ..library.matching import find_library_by_stremio, find_library_by_tmdb, library_item_on_watchlist
from ..library.playback import build_playback_file, probe_media_tracks
from ..library.scanner import scan_all
from ..models import LibraryItem, QueueItem, WatchlistItem
from ..obs.controller import aio, controller
from ..playqueue.manager import manager as queue_manager
from ..ws import hub

_ILLEGAL = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def _title_to_filename(title: str) -> str:
    cleaned = _ILLEGAL.sub("", title).strip().rstrip(". ")
    return (cleaned[:120] or "video")


class RenameBody(BaseModel):
    title: str


class LinkBody(BaseModel):
    tmdb_id: int
    media_type: str = Field(pattern="^(movie|series)$")
    season: int | None = None
    episode: int | None = None


class PlaybackBody(BaseModel):
    playback_audio_index: int | None = None
    playback_subtitle_index: int | None = None
    playback_burn_subtitles: bool | None = None


router = APIRouter(prefix="/api/library", tags=["library"],
                   dependencies=[Depends(auth.require_auth)])
_scan_lock = asyncio.Lock()
_scan_running = False


@router.get("")
def list_library():
    with SessionLocal() as s:
        items = s.query(LibraryItem).order_by(LibraryItem.added_at.desc()).all()
        grouped: dict[str, list] = {"youtube": [], "m3u8": [], "torrents": []}
        for item in items:
            row = item.to_dict()
            row["on_watchlist"] = library_item_on_watchlist(s, item)
            grouped.setdefault(item.folder, []).append(row)
        return grouped


@router.get("/by-path")
def library_by_path(path: str = Query(...)):
    with SessionLocal() as s:
        item = s.query(LibraryItem).filter(LibraryItem.path == path).first()
        return {"item": item.to_dict() if item else None}


@router.get("/{item_id}/tracks")
def library_tracks(item_id: int):
    with SessionLocal() as s:
        item = s.get(LibraryItem, item_id)
        if not item:
            raise HTTPException(404, "Not found")
        src = Path(item.path)
        if not src.is_file():
            raise HTTPException(404, "File no longer exists on disk")
        tracks = probe_media_tracks(src)
        return {
            "item_id": item_id,
            "path": item.path,
            "playback_audio_index": item.playback_audio_index,
            "playback_subtitle_index": item.playback_subtitle_index,
            "playback_burn_subtitles": bool(item.playback_burn_subtitles),
            **tracks,
        }


@router.patch("/{item_id}/playback")
async def set_playback(item_id: int, body: PlaybackBody):
    with SessionLocal() as s:
        item = s.get(LibraryItem, item_id)
        if not item:
            raise HTTPException(404, "Not found")
        if body.playback_audio_index is not None:
            item.playback_audio_index = body.playback_audio_index
        if body.playback_subtitle_index is not None:
            item.playback_subtitle_index = body.playback_subtitle_index
        if body.playback_burn_subtitles is not None:
            item.playback_burn_subtitles = body.playback_burn_subtitles
        s.commit()
        return item.to_dict()


@router.post("/{item_id}/playback/apply")
async def apply_playback(item_id: int):
    """Rebuild remux cache and restart OBS if this item is currently playing."""
    with SessionLocal() as s:
        item = s.get(LibraryItem, item_id)
        if not item:
            raise HTTPException(404, "Not found")
        snap = queue_manager.snapshot()
        cur = snap.get("current")
        if not cur or cur.get("library_path") != item.path:
            return {"ok": True, "playback_path": item.path, "deferred": True}
        try:
            path = await asyncio.to_thread(build_playback_file, item)
        except Exception as exc:
            raise HTTPException(400, str(exc)) from exc
        await aio(controller.play_file, path)
        await queue_manager.broadcast_player()
        return {"ok": True, "playback_path": path, "deferred": False}


@router.get("/match")
def library_match(
    media_type: str = Query(..., pattern="^(movie|series)$"),
    tmdb_id: int | None = None,
    stremio_id: str | None = None,
    season: int | None = None,
    episode: int | None = None,
    db=Depends(get_db),
):
    lib = None
    sid = (stremio_id or "").strip()
    if sid:
        lib = find_library_by_stremio(db, sid, season, episode)
    if not lib and tmdb_id:
        lib = find_library_by_tmdb(db, tmdb_id, media_type, season, episode)
    return {"match": lib.to_dict() if lib else None}


async def _rescan():
    global _scan_running
    await hub.broadcast("library_scan_started", {})
    try:
        await asyncio.to_thread(scan_all)
        await hub.broadcast("library_update", {})
        await hub.broadcast("library_scan_finished", {"ok": True})
    except Exception as exc:  # noqa: BLE001
        await hub.broadcast("library_scan_finished", {"ok": False, "error": str(exc)})
    finally:
        _scan_running = False


@router.post("/scan")
async def scan(background: BackgroundTasks):
    global _scan_running
    async with _scan_lock:
        if _scan_running:
            raise HTTPException(409, "Library scan is already running")
        _scan_running = True
    background.add_task(_rescan)
    return {"ok": True, "scanning": True}


@router.get("/scan/status")
async def scan_status():
    return {"scanning": _scan_running}


@router.patch("/{item_id}")
async def rename_item(item_id: int, body: RenameBody):
    title = body.title.strip()
    if not title:
        raise HTTPException(400, "Title is required")

    old_path = ""
    with SessionLocal() as s:
        item = s.get(LibraryItem, item_id)
        if not item:
            raise HTTPException(404, "Not found")
        old_path = item.path
        src = Path(old_path)
        if not src.exists():
            raise HTTPException(404, "File no longer exists on disk")
        stem = _title_to_filename(title)
        dest = src.with_name(f"{stem}{src.suffix}")
        if dest.resolve() != src.resolve():
            if dest.exists():
                raise HTTPException(409, f'"{dest.name}" already exists in this folder')
            try:
                src.rename(dest)
            except OSError as exc:
                raise HTTPException(500, f"Could not rename file: {exc}") from exc
        new_path = str(dest.resolve())
        item.path = new_path
        item.filename = dest.name
        item.title = title
        for q in s.query(QueueItem).filter(QueueItem.library_path == old_path).all():
            q.library_path = new_path
            q.title = title
        s.commit()
        data = item.to_dict()

    await hub.broadcast("library_update", {})
    await queue_manager.broadcast()
    return data


@router.post("/{item_id}/link")
async def link_item(item_id: int, body: LinkBody):
    with SessionLocal() as s:
        item = s.get(LibraryItem, item_id)
        if not item:
            raise HTTPException(404, "Not found")

        try:
            await apply_tmdb_link(
                s,
                item,
                tmdb_id=body.tmdb_id,
                media_type=body.media_type,
                season=body.season,
                episode=body.episode,
            )
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        except Exception as exc:
            raise HTTPException(400, f"Could not load TMDB title: {exc}") from exc

        s.commit()
        data = item.to_dict()

    await hub.broadcast("library_update", {})
    await queue_manager.broadcast()
    return data


@router.post("/{item_id}/unlink")
async def unlink_item(item_id: int):
    with SessionLocal() as s:
        item = s.get(LibraryItem, item_id)
        if not item:
            raise HTTPException(404, "Not found")
        item.tmdb_id = None
        item.media_type = ""
        item.season = None
        item.episode = None
        item.tmdb_title = ""
        item.tmdb_poster = ""
        item.tmdb_year = ""
        item.episode_title = ""
        sync_queue_from_library(s, item)
        sync_watchlist_from_library(s, item)
        s.commit()
        data = item.to_dict()

    await hub.broadcast("library_update", {})
    await queue_manager.broadcast()
    return data


@router.delete("/{item_id}")
async def delete_item(item_id: int, user: auth.CurrentUser = Depends(auth.require_auth)):
    with SessionLocal() as s:
        item = s.get(LibraryItem, item_id)
        if not item:
            raise HTTPException(404, "Not found")
        deleted_title = item.display_title()
        s.query(WatchlistItem).filter(WatchlistItem.library_item_id == item_id).update(
            {WatchlistItem.library_item_id: None},
            synchronize_session=False,
        )
        try:
            if os.path.exists(item.path):
                os.remove(item.path)
        except OSError as exc:
            raise HTTPException(500, f"Could not delete file: {exc}") from exc
        s.delete(item)
        s.commit()
    record_event("library_delete", deleted_title, user=user)
    await hub.broadcast("library_update", {"reason": "deleted"})
    return {"ok": True}
