"""Resolve AIOStreams manifest base URL from the local self-hosted instance."""
from __future__ import annotations

import sqlite3
from pathlib import Path

from .config import PROJECT_ROOT

_AIO_DIR = PROJECT_ROOT / "AIOStreams"
_ENV_FILE = _AIO_DIR / ".env"
_DB_FILE = _AIO_DIR / "repo" / "data" / "db.sqlite"


def _parse_env_value(key: str, env_path: Path) -> str:
    prefix = f"{key}="
    for line in env_path.read_text(encoding="utf-8", errors="replace").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if stripped.startswith(prefix):
            return stripped[len(prefix) :].strip().strip('"').strip("'")
    return ""


def _read_base_url(env_path: Path) -> str:
    base = _parse_env_value("BASE_URL", env_path).rstrip("/")
    if base:
        return base
    port = _parse_env_value("PORT", env_path) or "3000"
    return f"http://localhost:{port}"


def _latest_user_uuid(db_path: Path) -> str | None:
    con = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True)
    try:
        cur = con.cursor()
        cur.execute(
            """
            SELECT uuid FROM users
            ORDER BY
              COALESCE(accessed_at, updated_at, created_at) DESC,
              created_at DESC
            LIMIT 1
            """
        )
        row = cur.fetchone()
        return str(row[0]).strip() if row and row[0] else None
    finally:
        con.close()


def discover_local_aiostreams_base(
    *,
    project_root: Path | None = None,
) -> str:
    """Build manifest base from local AIOStreams/.env + users.uuid in SQLite."""
    root = project_root or PROJECT_ROOT
    env_path = root / "AIOStreams" / ".env"
    db_path = root / "AIOStreams" / "repo" / "data" / "db.sqlite"
    if not env_path.is_file() or not db_path.is_file():
        return ""
    try:
        uuid = _latest_user_uuid(db_path)
    except sqlite3.Error:
        return ""
    if not uuid:
        return ""
    base = _read_base_url(env_path)
    return f"{base}/stremio/{uuid}" if base else ""
