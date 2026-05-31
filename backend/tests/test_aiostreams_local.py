import sqlite3
from pathlib import Path
from unittest.mock import patch

from app import settings_store
from app.aiostreams_local import discover_local_aiostreams_base


def _seed_aiostreams(root: Path, *, uuid: str, base_url: str = "http://localhost:3000") -> None:
    env_path = root / "AIOStreams" / ".env"
    db_path = root / "AIOStreams" / "repo" / "data" / "db.sqlite"
    env_path.parent.mkdir(parents=True)
    db_path.parent.mkdir(parents=True)
    env_path.write_text(f"BASE_URL={base_url}\nPORT=3000\n", encoding="utf-8")
    con = sqlite3.connect(db_path)
    con.execute(
        """
        CREATE TABLE users (
            uuid TEXT PRIMARY KEY,
            password_hash TEXT,
            config TEXT,
            config_salt TEXT,
            created_at TEXT,
            updated_at TEXT,
            accessed_at TEXT
        )
        """
    )
    con.execute(
        "INSERT INTO users VALUES (?, '', '', '', '2026-01-01', '2026-01-02', '2026-01-03')",
        (uuid,),
    )
    con.commit()
    con.close()


def test_discover_local_aiostreams_base(tmp_path: Path):
    _seed_aiostreams(tmp_path, uuid="51f61df2-89c3-49b4-b085-146dae793c02")
    assert (
        discover_local_aiostreams_base(project_root=tmp_path)
        == "http://localhost:3000/stremio/51f61df2-89c3-49b4-b085-146dae793c02"
    )


def test_discover_missing_files(tmp_path: Path):
    assert discover_local_aiostreams_base(project_root=tmp_path) == ""


def test_aiostreams_auto_mode_uses_discovered(tmp_path: Path, db):
    _seed_aiostreams(tmp_path, uuid="abc-123")
    with (
        patch("app.settings_store._default", return_value=""),
        patch(
            "app.settings_store.discover_local_aiostreams_base",
            return_value="http://localhost:3000/stremio/abc-123",
        ),
    ):
        settings_store.reset_aiostreams_auto()
        assert settings_store.is_aiostreams_auto() is True
        assert settings_store.get_aiostreams_effective() == "http://localhost:3000/stremio/abc-123"


def test_aiostreams_manual_mode_uses_override(db):
    settings_store.set_value("aiostreams_auto", False)
    settings_store.set_value("aiostreams_base", "https://example.com/stremio/manual")
    assert settings_store.is_aiostreams_auto() is False
    assert settings_store.get_aiostreams_effective() == "https://example.com/stremio/manual"


def test_reset_aiostreams_auto_clears_manual(db):
    settings_store.set_value("aiostreams_auto", False)
    settings_store.set_value("aiostreams_base", "https://example.com/stremio/manual")
    settings_store.reset_aiostreams_auto()
    assert settings_store.is_aiostreams_auto() is True
    assert settings_store.get_aiostreams_manual() == ""
