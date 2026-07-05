from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import settings

DB_PATH = Path(settings.data_dir) / "app.db"

engine = create_engine(
    f"sqlite:///{DB_PATH}",
    connect_args={"check_same_thread": False},
)


@event.listens_for(engine, "connect")
def _set_sqlite_pragmas(dbapi_conn, _record):
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA busy_timeout = 5000")
    cur.execute("PRAGMA journal_mode = WAL")
    cur.execute("PRAGMA synchronous = NORMAL")
    cur.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def _migrate_schema() -> None:
    from sqlalchemy import inspect, text

    insp = inspect(engine)
    if not insp.has_table("watchlist_items"):
        return
    cols = {c["name"] for c in insp.get_columns("watchlist_items")}
    with engine.begin() as conn:
        if "overview" not in cols:
            conn.execute(text("ALTER TABLE watchlist_items ADD COLUMN overview TEXT DEFAULT ''"))
        if "air_date" not in cols:
            conn.execute(text("ALTER TABLE watchlist_items ADD COLUMN air_date VARCHAR DEFAULT ''"))
        if "stremio_id" not in cols:
            conn.execute(text("ALTER TABLE watchlist_items ADD COLUMN stremio_id VARCHAR DEFAULT ''"))

    if insp.has_table("library_items"):
        lib_cols = {c["name"] for c in insp.get_columns("library_items")}
        lib_migrations = [
            ("tmdb_id", "INTEGER"),
            ("media_type", "VARCHAR DEFAULT ''"),
            ("season", "INTEGER"),
            ("episode", "INTEGER"),
            ("tmdb_title", "VARCHAR DEFAULT ''"),
            ("tmdb_poster", "VARCHAR DEFAULT ''"),
            ("tmdb_year", "VARCHAR DEFAULT ''"),
            ("episode_title", "VARCHAR DEFAULT ''"),
            ("playback_audio_index", "INTEGER"),
            ("playback_subtitle_index", "INTEGER"),
            ("playback_burn_subtitles", "BOOLEAN DEFAULT 0"),
            ("stremio_id", "VARCHAR DEFAULT ''"),
        ]
        with engine.begin() as conn:
            for name, col_type in lib_migrations:
                if name not in lib_cols:
                    conn.execute(text(f"ALTER TABLE library_items ADD COLUMN {name} {col_type}"))

    if insp.has_table("jobs"):
        job_cols = {c["name"] for c in insp.get_columns("jobs")}
        job_migrations = [
            ("restart_source", "TEXT DEFAULT ''"),
            ("download_mode", "VARCHAR DEFAULT 'normal'"),
            ("cache_file_idx", "INTEGER"),
            ("cache_filename_hint", "VARCHAR DEFAULT ''"),
            ("cache_size_bytes", "INTEGER DEFAULT 0"),
            ("link_tmdb_id", "INTEGER"),
            ("link_media_type", "VARCHAR DEFAULT ''"),
            ("link_season", "INTEGER"),
            ("link_episode", "INTEGER"),
            ("link_watchlist_id", "INTEGER"),
            ("link_stremio_id", "VARCHAR DEFAULT ''"),
            ("link_series_title", "VARCHAR DEFAULT ''"),
            ("link_status", "VARCHAR DEFAULT ''"),
            ("link_error", "TEXT DEFAULT ''"),
        ]
        with engine.begin() as conn:
            for name, col_type in job_migrations:
                if name not in job_cols:
                    conn.execute(text(f"ALTER TABLE jobs ADD COLUMN {name} {col_type}"))

    if insp.has_table("users"):
        user_cols = {c["name"] for c in insp.get_columns("users")}
        with engine.begin() as conn:
            if "session_version" not in user_cols:
                conn.execute(text("ALTER TABLE users ADD COLUMN session_version INTEGER DEFAULT 0"))
            if "watchlist_stats_excluded" not in user_cols:
                conn.execute(
                    text("ALTER TABLE users ADD COLUMN watchlist_stats_excluded BOOLEAN DEFAULT 0")
                )
            if "watchlist_stats_excluded_at" not in user_cols:
                conn.execute(text("ALTER TABLE users ADD COLUMN watchlist_stats_excluded_at DATETIME"))
            if "allow_local_download" not in user_cols:
                conn.execute(
                    text("ALTER TABLE users ADD COLUMN allow_local_download BOOLEAN DEFAULT 0")
                )

    if insp.has_table("watchlist_groups"):
        group_cols = {c["name"] for c in insp.get_columns("watchlist_groups")}
        with engine.begin() as conn:
            if "wheel_enabled" not in group_cols:
                conn.execute(
                    text("ALTER TABLE watchlist_groups ADD COLUMN wheel_enabled BOOLEAN DEFAULT 1")
                )

    if insp.has_table("watchlist_items"):
        item_cols = {c["name"] for c in insp.get_columns("watchlist_items")}
        item_migrations = [
            ("group_id", "INTEGER"),
            ("parent_id", "INTEGER"),
            ("kind", "VARCHAR DEFAULT 'movie'"),
            ("tmdb_id", "INTEGER"),
            ("media_type", "VARCHAR DEFAULT 'movie'"),
            ("season", "INTEGER"),
            ("episode", "INTEGER"),
            ("title", "VARCHAR DEFAULT ''"),
            ("poster", "VARCHAR DEFAULT ''"),
            ("year", "VARCHAR DEFAULT ''"),
            ("library_item_id", "INTEGER"),
            ("list_section", "VARCHAR DEFAULT 'to_watch'"),
            ("sort_order", "INTEGER DEFAULT 0"),
            ("created_at", "DATETIME"),
        ]
        with engine.begin() as conn:
            for name, col_type in item_migrations:
                if name not in item_cols:
                    conn.execute(text(f"ALTER TABLE watchlist_items ADD COLUMN {name} {col_type}"))

    if insp.has_table("user_ratings"):
        rating_cols = {c["name"] for c in insp.get_columns("user_ratings")}
        with engine.begin() as conn:
            if "rated_at" not in rating_cols:
                conn.execute(text("ALTER TABLE user_ratings ADD COLUMN rated_at DATETIME"))

    if insp.has_table("queue_items"):
        queue_cols = {c["name"] for c in insp.get_columns("queue_items")}
        with engine.begin() as conn:
            if "queued_by_user_id" not in queue_cols:
                conn.execute(text("ALTER TABLE queue_items ADD COLUMN queued_by_user_id INTEGER"))
            if "queued_by" not in queue_cols:
                conn.execute(text("ALTER TABLE queue_items ADD COLUMN queued_by VARCHAR DEFAULT ''"))


def init_db() -> None:
    from . import models  # noqa: F401

    Base.metadata.create_all(engine)
    _migrate_schema()
    from .bootstrap import bootstrap_users

    db = SessionLocal()
    try:
        bootstrap_users(db)
    finally:
        db.close()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
