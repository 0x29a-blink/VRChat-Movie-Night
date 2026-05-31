import re
from pathlib import Path

from sqlalchemy.orm import Session

from ..models import LibraryItem, WatchlistItem


def _normalize_title_name(s: str) -> str:
    t = re.sub(r"\(\d{4}\)", "", s or "")
    return re.sub(r"[^a-z0-9]+", "", t.lower())


def find_library_by_tmdb(
    db: Session,
    tmdb_id: int,
    media_type: str,
    season: int | None = None,
    episode: int | None = None,
) -> LibraryItem | None:
    q = db.query(LibraryItem).filter(LibraryItem.tmdb_id == tmdb_id)
    if media_type == "series" and season is not None and episode is not None:
        q = q.filter(
            LibraryItem.media_type == "series",
            LibraryItem.season == season,
            LibraryItem.episode == episode,
        )
    elif media_type == "series":
        q = q.filter(LibraryItem.media_type == "series", LibraryItem.season.is_(None))
    else:
        q = q.filter(LibraryItem.media_type == "movie")
    for lib in q.all():
        if Path(lib.path).is_file():
            return lib
    return None


def find_library_for_watchlist_item(db: Session, item: WatchlistItem) -> dict | None:
    if item.kind not in ("movie", "series", "episode"):
        return None

    if item.library_item_id:
        lib = db.get(LibraryItem, item.library_item_id)
        if lib and Path(lib.path).is_file():
            return lib.to_dict()

    if item.tmdb_id:
        if item.kind == "episode" and item.season is not None and item.episode is not None:
            lib = find_library_by_tmdb(db, item.tmdb_id, "series", item.season, item.episode)
        elif item.kind == "series":
            lib = find_library_by_tmdb(db, item.tmdb_id, "series")
        else:
            lib = find_library_by_tmdb(db, item.tmdb_id, "movie")
        if lib:
            return lib.to_dict()

    raw_title = (item.title or "").split(" S")[0].split(" —")[0].strip()
    target = _normalize_title_name(raw_title)
    if not target:
        return None

    for lib in db.query(LibraryItem).filter(LibraryItem.folder.in_(["torrents", "m3u8"])).all():
        if not Path(lib.path).is_file():
            continue
        cand = _normalize_title_name(lib.title or lib.filename)
        if not cand:
            continue
        if cand == target or (len(target) > 4 and (target in cand or cand in target)):
            return lib.to_dict()
    return None
