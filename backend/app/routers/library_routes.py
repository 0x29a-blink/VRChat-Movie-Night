import asyncio
import os
import re
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from .. import auth
from ..db import SessionLocal, get_db
from ..library.linking import apply_tmdb_link, sync_queue_from_library, sync_watchlist_from_library
from ..library.matching import find_library_by_tmdb
from ..library.scanner import scan_all
from ..models import LibraryItem, QueueItem, WatchlistItem
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


router = APIRouter(prefix="/api/library", tags=["library"],
                   dependencies=[Depends(auth.require_auth)])


@router.get("")
def list_library():
    with SessionLocal() as s:
        items = s.query(LibraryItem).order_by(LibraryItem.added_at.desc()).all()
        grouped: dict[str, list] = {"youtube": [], "m3u8": [], "torrents": []}
        for item in items:
            grouped.setdefault(item.folder, []).append(item.to_dict())
        return grouped


@router.get("/match")
def library_match(
    tmdb_id: int = Query(...),
    media_type: str = Query(..., pattern="^(movie|series)$"),
    season: int | None = None,
    episode: int | None = None,
    db=Depends(get_db),
):
    lib = find_library_by_tmdb(db, tmdb_id, media_type, season, episode)
    return {"match": lib.to_dict() if lib else None}


async def _rescan():
    await asyncio.to_thread(scan_all)
    await hub.broadcast("library_update", {})


@router.post("/scan")
async def scan(background: BackgroundTasks):
    background.add_task(_rescan)
    return {"ok": True}


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
        _sync_queue_from_library(s, item)
        s.commit()
        data = item.to_dict()

    await hub.broadcast("library_update", {})
    await queue_manager.broadcast()
    return data


@router.delete("/{item_id}")
async def delete_item(item_id: int):
    with SessionLocal() as s:
        item = s.get(LibraryItem, item_id)
        if not item:
            raise HTTPException(404, "Not found")
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
    await hub.broadcast("library_update", {"reason": "deleted"})
    return {"ok": True}
