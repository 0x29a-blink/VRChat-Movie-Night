from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    type: Mapped[str] = mapped_column(String, index=True)  # youtube | m3u8 | torrent
    source: Mapped[str] = mapped_column(Text)
    title: Mapped[str] = mapped_column(String, default="")
    status: Mapped[str] = mapped_column(String, default="queued", index=True)
    percent: Mapped[float] = mapped_column(Float, default=0.0)
    speed: Mapped[str] = mapped_column(String, default="")
    eta: Mapped[str] = mapped_column(String, default="")
    downloaded: Mapped[int] = mapped_column(Integer, default=0)
    total: Mapped[int] = mapped_column(Integer, default=0)
    output_path: Mapped[str] = mapped_column(Text, default="")
    error: Mapped[str] = mapped_column(Text, default="")
    link_tmdb_id = mapped_column(Integer, nullable=True)
    link_media_type: Mapped[str] = mapped_column(String, default="")
    link_season = mapped_column(Integer, nullable=True)
    link_episode = mapped_column(Integer, nullable=True)
    link_watchlist_id = mapped_column(Integer, nullable=True)
    link_stremio_id: Mapped[str] = mapped_column(String, default="")
    link_series_title: Mapped[str] = mapped_column(String, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "type": self.type,
            "source": self.source,
            "title": self.title,
            "status": self.status,
            "percent": round(self.percent, 1),
            "speed": self.speed,
            "eta": self.eta,
            "downloaded": self.downloaded,
            "total": self.total,
            "output_path": self.output_path,
            "error": self.error,
            "link_tmdb_id": self.link_tmdb_id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class LibraryItem(Base):
    __tablename__ = "library_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    path: Mapped[str] = mapped_column(Text, unique=True, index=True)
    filename: Mapped[str] = mapped_column(String)
    title: Mapped[str] = mapped_column(String, default="")
    folder: Mapped[str] = mapped_column(String, index=True)
    size: Mapped[int] = mapped_column(Integer, default=0)
    duration: Mapped[float] = mapped_column(Float, default=0.0)
    thumbnail: Mapped[str] = mapped_column(String, default="")
    tmdb_id = mapped_column(Integer, nullable=True, index=True)
    media_type: Mapped[str] = mapped_column(String, default="")  # movie | series
    season = mapped_column(Integer, nullable=True)
    episode = mapped_column(Integer, nullable=True)
    tmdb_title: Mapped[str] = mapped_column(String, default="")
    tmdb_poster: Mapped[str] = mapped_column(String, default="")
    tmdb_year: Mapped[str] = mapped_column(String, default="")
    episode_title: Mapped[str] = mapped_column(String, default="")
    stremio_id: Mapped[str] = mapped_column(String, default="", index=True)
    playback_audio_index = mapped_column(Integer, nullable=True)
    playback_subtitle_index = mapped_column(Integer, nullable=True)
    playback_burn_subtitles: Mapped[bool] = mapped_column(Boolean, default=False)
    added_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    def display_title(self) -> str:
        if not self.tmdb_id:
            return self.title or self.filename
        if self.media_type == "series" and self.season is not None and self.episode is not None:
            series = self.tmdb_title or self.title or self.filename
            ep = self.episode_title or f"S{self.season:02d}E{self.episode:02d}"
            return f"{series} — {ep}"
        return self.tmdb_title or self.title or self.filename

    def display_poster(self) -> str:
        if self.tmdb_poster:
            return self.tmdb_poster
        return f"/thumbnails/{self.thumbnail}" if self.thumbnail else ""

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "path": self.path,
            "filename": self.filename,
            "title": self.title or self.filename,
            "display_title": self.display_title(),
            "folder": self.folder,
            "size": self.size,
            "duration": self.duration,
            "thumbnail": f"/thumbnails/{self.thumbnail}" if self.thumbnail else "",
            "poster": self.display_poster(),
            "tmdb_id": self.tmdb_id,
            "media_type": self.media_type or None,
            "season": self.season,
            "episode": self.episode,
            "tmdb_title": self.tmdb_title or "",
            "tmdb_poster": self.tmdb_poster or "",
            "tmdb_year": self.tmdb_year or "",
            "episode_title": self.episode_title or "",
            "stremio_id": self.stremio_id or None,
            "linked": bool(self.tmdb_id or self.stremio_id),
            "playback_audio_index": self.playback_audio_index,
            "playback_subtitle_index": self.playback_subtitle_index,
            "playback_burn_subtitles": bool(self.playback_burn_subtitles),
            "added_at": self.added_at.isoformat() if self.added_at else None,
        }


class QueueItem(Base):
    __tablename__ = "queue_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    library_path: Mapped[str] = mapped_column(Text)
    title: Mapped[str] = mapped_column(String, default="")
    thumbnail: Mapped[str] = mapped_column(String, default="")
    duration: Mapped[float] = mapped_column(Float, default=0.0)
    position: Mapped[int] = mapped_column(Integer, default=0, index=True)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "library_path": self.library_path,
            "title": self.title,
            "thumbnail": self.thumbnail,
            "duration": self.duration,
            "position": self.position,
        }


class Setting(Base):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="")


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String, unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String)
    role: Mapped[str] = mapped_column(String, default="member")  # admin | member
    watchlist_stats_excluded: Mapped[bool] = mapped_column(Boolean, default=False)
    watchlist_stats_excluded_at = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "username": self.username,
            "role": self.role,
            "watchlist_stats_excluded": bool(self.watchlist_stats_excluded),
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class WatchlistItemUserExclusion(Base):
    __tablename__ = "watchlist_item_user_exclusions"
    __table_args__ = (UniqueConstraint("item_id", "user_id", name="uq_watchlist_item_user_exclusion"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    item_id: Mapped[int] = mapped_column(Integer, ForeignKey("watchlist_items.id"), index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class WatchlistGroup(Base):
    __tablename__ = "watchlist_groups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, index=True)
    wheel_enabled: Mapped[bool] = mapped_column(Boolean, default=True)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "sort_order": self.sort_order,
            "wheel_enabled": self.wheel_enabled,
        }


class WatchlistItem(Base):
    __tablename__ = "watchlist_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    group_id = mapped_column(Integer, ForeignKey("watchlist_groups.id"), nullable=True, index=True)
    parent_id = mapped_column(Integer, ForeignKey("watchlist_items.id"), nullable=True, index=True)
    kind: Mapped[str] = mapped_column(String, index=True)  # movie | series | episode | collection
    tmdb_id = mapped_column(Integer, nullable=True)
    media_type: Mapped[str] = mapped_column(String, default="movie")  # movie | series
    season = mapped_column(Integer, nullable=True)
    episode = mapped_column(Integer, nullable=True)
    title: Mapped[str] = mapped_column(String, default="")
    poster: Mapped[str] = mapped_column(String, default="")
    year: Mapped[str] = mapped_column(String, default="")
    overview: Mapped[str] = mapped_column(Text, default="")
    air_date: Mapped[str] = mapped_column(String, default="")
    stremio_id: Mapped[str] = mapped_column(String, default="", index=True)
    library_item_id = mapped_column(Integer, ForeignKey("library_items.id"), nullable=True)
    list_section: Mapped[str] = mapped_column(String, default="to_watch", index=True)  # to_watch | watched
    sort_order: Mapped[int] = mapped_column(Integer, default=0, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class UserWatchStatus(Base):
    __tablename__ = "user_watch_status"
    __table_args__ = (UniqueConstraint("user_id", "item_id", name="uq_user_watch"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True)
    item_id: Mapped[int] = mapped_column(Integer, ForeignKey("watchlist_items.id"), index=True)
    watched: Mapped[bool] = mapped_column(Boolean, default=False)
    watched_at = mapped_column(DateTime, nullable=True)


class UserRating(Base):
    __tablename__ = "user_ratings"
    __table_args__ = (UniqueConstraint("user_id", "item_id", name="uq_user_rating"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True)
    item_id: Mapped[int] = mapped_column(Integer, ForeignKey("watchlist_items.id"), index=True)
    stars: Mapped[float] = mapped_column(Float, default=0)
    rated_at = mapped_column(DateTime, nullable=True)


class WatchlistComment(Base):
    __tablename__ = "watchlist_comments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True)
    item_id: Mapped[int] = mapped_column(Integer, ForeignKey("watchlist_items.id"), index=True)
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class WheelPreset(Base):
    """Global saved label lists for custom wheel spins (genres, themes, etc.)."""

    __tablename__ = "wheel_presets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String)
    labels_json: Mapped[str] = mapped_column(Text, default="[]")
    sort_order: Mapped[int] = mapped_column(Integer, default=0, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    def to_dict(self) -> dict:
        import json

        try:
            labels = json.loads(self.labels_json or "[]")
        except json.JSONDecodeError:
            labels = []
        if not isinstance(labels, list):
            labels = []
        return {
            "id": self.id,
            "name": self.name,
            "labels": [str(x) for x in labels if str(x).strip()],
            "sort_order": self.sort_order,
        }
