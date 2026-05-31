from typing import Any

from pydantic import BaseModel, Field


class DownloadLinkMeta(BaseModel):
    tmdb_id: int | None = None
    stremio_id: str | None = None
    series_title: str | None = None
    media_type: str = Field(pattern="^(movie|series)$")
    season: int | None = None
    episode: int | None = None
    watchlist_item_id: int | None = None


def apply_link_meta_to_job(job, meta: DownloadLinkMeta | dict | None) -> None:
    if not meta:
        return
    if isinstance(meta, DownloadLinkMeta):
        data = meta.model_dump()
    else:
        data = meta
    job.link_tmdb_id = int(data["tmdb_id"]) if data.get("tmdb_id") else None
    job.link_stremio_id = (data.get("stremio_id") or "").strip()
    job.link_series_title = (data.get("series_title") or "").strip()
    job.link_media_type = data.get("media_type") or "movie"
    job.link_season = data.get("season")
    job.link_episode = data.get("episode")
    job.link_watchlist_id = data.get("watchlist_item_id")


def job_link_meta(job) -> dict[str, Any] | None:
    if not job.link_tmdb_id and not (job.link_stremio_id or "").strip():
        return None
    out: dict[str, Any] = {
        "media_type": job.link_media_type or "movie",
        "season": job.link_season,
        "episode": job.link_episode,
        "watchlist_item_id": job.link_watchlist_id,
    }
    if job.link_tmdb_id:
        out["tmdb_id"] = job.link_tmdb_id
    if job.link_stremio_id:
        out["stremio_id"] = job.link_stremio_id
    if job.link_series_title:
        out["series_title"] = job.link_series_title
    return out
