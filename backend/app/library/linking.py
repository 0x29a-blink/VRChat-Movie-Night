"""Apply TMDB metadata to library items and sync watchlist / queue."""

from sqlalchemy.orm import Session

from ..models import LibraryItem, QueueItem, WatchlistItem
from ..search import anime_meta, tmdb


async def apply_anime_link(
    s: Session,
    lib: LibraryItem,
    *,
    stremio_id: str,
    series_title: str = "",
    season: int | None = None,
    episode: int | None = None,
    watchlist_item_id: int | None = None,
) -> None:
    sid = stremio_id.strip()
    lib.stremio_id = sid
    lib.media_type = "series"

    meta = await anime_meta.fetch_stremio_meta(sid, "anime")
    show_name = series_title.strip() or (meta.get("name") if meta else "") or lib.title
    lib.tmdb_title = show_name
    if meta:
        lib.tmdb_year = (meta.get("releaseInfo") or "")[:4]
        poster = meta.get("poster") or ""
        if poster:
            lib.tmdb_poster = poster

    lib.season = None
    lib.episode = None
    lib.episode_title = ""

    if season is not None and episode is not None:
        lib.season = season
        lib.episode = episode
        if meta:
            for ep in anime_meta.episodes_for_season(meta, season):
                if ep.get("episode_number") == episode:
                    lib.episode_title = ep.get("name") or ""
                    if ep.get("still"):
                        lib.tmdb_poster = ep["still"]
                    break

    if not lib.tmdb_id and show_name and _key_available():
        try:
            results = await tmdb.search(show_name)
            for row in results:
                if row.get("type") == "series" and row.get("tmdb_id"):
                    lib.tmdb_id = int(row["tmdb_id"])
                    if not lib.tmdb_poster and row.get("poster"):
                        lib.tmdb_poster = row["poster"]
                    if not lib.tmdb_year and row.get("year"):
                        lib.tmdb_year = row["year"]
                    break
        except Exception:
            pass

    if watchlist_item_id:
        row = s.get(WatchlistItem, watchlist_item_id)
        if row:
            row.library_item_id = lib.id

    sync_watchlist_from_library(s, lib)
    sync_queue_from_library(s, lib)


def _key_available() -> bool:
    from .. import settings_store

    return bool((settings_store.get("tmdb_api_key", "") or "").strip())


async def apply_tmdb_link(
    s: Session,
    lib: LibraryItem,
    *,
    tmdb_id: int,
    media_type: str,
    season: int | None = None,
    episode: int | None = None,
    watchlist_item_id: int | None = None,
) -> None:
    info = await tmdb.details(tmdb_id, media_type)

    lib.tmdb_id = tmdb_id
    lib.media_type = media_type
    lib.stremio_id = ""
    lib.tmdb_title = info.get("title") or ""
    lib.tmdb_year = info.get("year") or ""
    lib.tmdb_poster = info.get("poster") or ""
    lib.season = None
    lib.episode = None
    lib.episode_title = ""

    if media_type == "series" and season is not None and episode is not None:
        episodes = await tmdb.season_episodes(tmdb_id, season)
        ep = next((e for e in episodes if e.get("episode_number") == episode), None)
        if not ep:
            raise ValueError("Episode not found on TMDB")
        lib.season = season
        lib.episode = episode
        lib.episode_title = ep.get("name") or ""
        if ep.get("still"):
            lib.tmdb_poster = ep["still"]

    if watchlist_item_id:
        row = s.get(WatchlistItem, watchlist_item_id)
        if row:
            row.library_item_id = lib.id

    sync_watchlist_from_library(s, lib)
    sync_queue_from_library(s, lib)


def sync_watchlist_from_library(s: Session, lib: LibraryItem) -> None:
    rows = s.query(WatchlistItem).filter(WatchlistItem.library_item_id == lib.id).all()
    if lib.tmdb_id:
        q = s.query(WatchlistItem).filter(
            WatchlistItem.library_item_id.is_(None),
            WatchlistItem.tmdb_id == lib.tmdb_id,
        )
        if lib.media_type == "series" and lib.season is not None and lib.episode is not None:
            q = q.filter(
                WatchlistItem.kind == "episode",
                WatchlistItem.season == lib.season,
                WatchlistItem.episode == lib.episode,
            )
        elif lib.media_type == "series":
            q = q.filter(WatchlistItem.kind == "series")
        else:
            q = q.filter(WatchlistItem.kind == "movie")
        rows = list(rows) + q.all()

    seen: set[int] = set()
    for row in rows:
        if row.id in seen or not lib.tmdb_id:
            continue
        seen.add(row.id)
        row.library_item_id = lib.id
        row.tmdb_id = lib.tmdb_id
        row.media_type = lib.media_type or "movie"
        row.poster = lib.tmdb_poster or row.poster
        row.year = lib.tmdb_year or row.year
        if lib.media_type == "series" and lib.season is not None and lib.episode is not None:
            row.kind = "episode"
            row.season = lib.season
            row.episode = lib.episode
            row.title = lib.display_title()
        elif lib.media_type == "series":
            row.kind = "series"
            row.season = None
            row.episode = None
            row.title = lib.tmdb_title or row.title
        else:
            row.kind = "movie"
            row.season = None
            row.episode = None
            row.title = lib.tmdb_title or row.title


def sync_queue_from_library(s: Session, lib: LibraryItem) -> None:
    for q in s.query(QueueItem).filter(QueueItem.library_path == lib.path).all():
        q.title = lib.display_title()
        q.thumbnail = lib.display_poster()
