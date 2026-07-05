import asyncio
import warnings

from sqlalchemy.exc import SAWarning

from app.auth import COOKIE_NAME, hash_password, make_token
from app.models import Job, User, WatchlistGroup, WatchlistItem, WheelPreset


def test_preflight_authenticated(client, db):
    res = client.get("/api/health/preflight")
    assert res.status_code == 200
    data = res.json()
    assert data["api"] is True
    assert "obs_connected" in data
    assert "mediamtx_running" in data
    assert "hls_url" in data
    assert data["hls_url"].startswith("http://")
    assert ":8888/" in data["hls_url"]
    assert "live/vrstream/index.m3u8" in data["hls_url"]
    assert data["users"] >= 1
    assert "tools" in data
    assert "aiostreams_ok" in data
    assert "issues" in data
    assert "checklist_ok" in data


def test_preflight_warns_on_default_secrets(client, monkeypatch):
    from app.config import settings
    from app.routers import health_routes

    health_routes._reset_preflight_cache()
    monkeypatch.setattr(settings, "secret_key", "please-change-this-to-a-long-random-string")
    monkeypatch.setattr(settings, "app_password", "changeme")
    res = client.get("/api/health/preflight")
    assert res.status_code == 200
    issues = res.json()["issues"]
    assert any("SECRET_KEY is still the default" in issue for issue in issues)
    assert any("APP_PASSWORD is still the default" in issue for issue in issues)


def test_tool_checks_respect_runtime_deno_setting(db, monkeypatch):
    from app import settings_store, tool_checks

    seen: list[str] = []

    async def fake_check(name, cmd):
        seen.append(name)
        return tool_checks.ToolStatus(name=name, ok=True, detail="Available")

    settings_store.set_value("use_deno", False)
    monkeypatch.setattr(tool_checks, "_check_tool", fake_check)

    results = asyncio.run(tool_checks.check_all_tools())
    assert {r["name"] for r in results} == {"yt-dlp", "ffmpeg", "ffprobe"}
    assert "deno" not in seen


def test_stream_presets_list_when_obs_offline():
    from app.obs.controller import OBSNotConnectedError
    from app.obs.stream_settings import StreamSettingsService

    class OfflineController:
        def stream_status(self):
            raise OBSNotConnectedError("OBS is offline")

    presets = StreamSettingsService(OfflineController()).list_presets()

    assert presets["streaming"] is False
    assert presets["encoder_presets"]
    assert presets["video_presets"]


def _login_as(client, user: User) -> None:
    client.cookies.set(COOKIE_NAME, make_token(user))


def test_member_cannot_access_admin_settings_or_stream_routes(client, db):
    member = User(username="bob", password_hash=hash_password("test"), role="member")
    db.add(member)
    db.commit()
    db.refresh(member)
    _login_as(client, member)

    assert client.get("/api/settings").status_code == 403
    assert client.put("/api/settings", json={"skip_small": 9}).status_code == 403
    assert client.post("/api/stream/encoder/apply", json={"preset_id": "low"}).status_code == 403


def test_me_includes_capabilities(client):
    res = client.get("/api/me")
    assert res.status_code == 200
    caps = res.json()["user"]["capabilities"]
    assert caps["can_manage_settings"] is True
    assert caps["can_manage_users"] is True


def test_password_change_invalidates_existing_session(client, db):
    member = User(username="sessionuser", password_hash=hash_password("old-password"), role="member")
    db.add(member)
    db.commit()
    db.refresh(member)
    _login_as(client, member)

    res = client.post("/api/password", json={"new_password": "new-password"})
    assert res.status_code == 200
    assert client.get("/api/me").json()["authenticated"] is False


def test_admin_password_reset_invalidates_user_session(client, db):
    member = User(username="resetuser", password_hash=hash_password("old-password"), role="member")
    db.add(member)
    db.commit()
    db.refresh(member)
    old_token = make_token(member)

    res = client.post(f"/api/users/{member.id}/reset-password", json={"password": "new-password"})
    assert res.status_code == 200

    client.cookies.set(COOKIE_NAME, old_token)
    assert client.get("/api/me").json()["authenticated"] is False


def test_short_passwords_are_rejected(client, db):
    member = User(username="shortpw", password_hash=hash_password("old-password"), role="member")
    db.add(member)
    db.commit()
    db.refresh(member)
    _login_as(client, member)

    assert client.post("/api/password", json={"new_password": "short"}).status_code == 422


def test_settings_save_does_not_mark_active_download_failed(client, db):
    job = Job(
        id="active-job",
        type="youtube",
        source="https://example.test/video",
        restart_source="https://example.test/video",
        title="Active",
        status="downloading",
    )
    db.add(job)
    db.commit()

    res = client.put("/api/settings", json={"max_concurrent_downloads": 3})
    assert res.status_code == 200
    db.refresh(job)
    assert job.status == "downloading"
    assert job.error == ""


def test_member_cannot_queue_raw_path(client, db, tmp_path):
    member = User(username="rawpath", password_hash=hash_password("test"), role="member")
    db.add(member)
    db.commit()
    db.refresh(member)
    media = tmp_path / "movie.mkv"
    media.write_text("fake")

    _login_as(client, member)
    res = client.post("/api/queue/add", json={"path": str(media), "title": "Movie"})
    assert res.status_code == 403


def test_admin_raw_queue_path_must_be_inside_library(client, tmp_path):
    media = tmp_path / "movie.mkv"
    media.write_text("fake")
    res = client.post("/api/queue/add", json={"path": str(media), "title": "Movie"})
    assert res.status_code == 400
    assert "inside the library" in res.json()["detail"]


def test_restart_preserves_torbox_cache_mode(db, monkeypatch):
    from app.downloads.manager import manager

    job = Job(
        id="cache-job",
        type="torrent",
        source="https://cdn.example.test/file.mkv",
        restart_source="magnet:?xt=urn:btih:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        download_mode="torbox_cache",
        cache_file_idx=2,
        cache_filename_hint="movie.mkv",
        cache_size_bytes=123,
        title="Cached Movie",
        status="failed",
    )
    db.add(job)
    db.commit()
    captured = {}

    async def fake_add_torbox_cache(magnet, **kwargs):
        captured["magnet"] = magnet
        captured.update(kwargs)
        return {"ok": True}

    monkeypatch.setattr(manager, "add_torbox_cache", fake_add_torbox_cache)
    result = asyncio.run(manager.restart("cache-job"))

    assert result == {"ok": True}
    assert captured["magnet"] == job.restart_source
    assert captured["file_idx"] == 2
    assert captured["filename_hint"] == "movie.mkv"
    assert captured["size_bytes"] == 123


def test_download_link_failure_is_recorded(db):
    from app.downloads.manager import manager

    job = Job(
        id="link-job",
        type="torrent",
        source="https://example.test/file.mkv",
        restart_source="https://example.test/file.mkv",
        title="Linked Movie",
        status="completed",
        link_tmdb_id=123,
        link_media_type="movie",
        link_status="pending",
    )
    db.add(job)
    db.commit()

    asyncio.run(manager._mark_job_link_failed("link-job", "No library row"))
    db.refresh(job)

    assert job.link_status == "failed"
    assert job.link_error == "No library row"
    assert job.to_dict()["link_status"] == "failed"


def test_backup_import_replaces_watchlist(client, db):
    grp = WatchlistGroup(name="Import Group", sort_order=0)
    db.add(grp)
    db.flush()
    db.add(
        WatchlistItem(
            kind="movie",
            title="Old title",
            group_id=grp.id,
            tmdb_id=1,
            media_type="movie",
        )
    )
    db.commit()

    payload = {
        "version": 1,
        "users": [{"id": 1, "username": "admin", "role": "admin"}],
        "watchlist_groups": [{"id": 10, "name": "Restored", "sort_order": 0, "wheel_enabled": True}],
        "watchlist_items": [
            {
                "id": 100,
                "group_id": 10,
                "parent_id": None,
                "kind": "movie",
                "tmdb_id": 99,
                "media_type": "movie",
                "title": "Restored Movie",
                "poster": "",
                "year": "2020",
                "overview": "",
                "air_date": "",
                "library_item_id": None,
                "list_section": "to_watch",
                "sort_order": 0,
            }
        ],
        "user_watch_status": [],
        "user_ratings": [],
        "watchlist_comments": [],
        "library_items": [],
        "wheel_presets": [{"id": 1, "name": "Genres", "labels": ["Horror", "Comedy"], "sort_order": 0}],
        "settings": {},
    }

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always", SAWarning)
        res = client.post("/api/backup/import", json={"data": payload})
    assert res.status_code == 200
    assert not any("Identity map already had an identity" in str(w.message) for w in caught)
    body = res.json()
    assert body["ok"] is True
    assert body["items"] == 1
    assert body["groups"] == 1
    assert body["wheel_presets"] == 1

    titles = [i.title for i in db.query(WatchlistItem).all()]
    assert "Restored Movie" in titles
    assert "Old title" not in titles
    assert db.query(WheelPreset).count() == 1


def test_collect_unwatched_library_ids(client, db, tmp_path):
    from app.models import LibraryItem, User
    from app.routers.watchlist_routes import _collect_unwatched_library

    admin = db.query(User).filter(User.username == "admin").first()
    assert admin is not None

    lib_path = tmp_path / "movie.mkv"
    lib_path.write_text("fake")

    lib = LibraryItem(
        path=str(lib_path),
        filename="movie.mkv",
        title="Queue Me",
        folder="torrents",
        tmdb_id=50,
        media_type="movie",
    )
    db.add(lib)
    db.flush()

    db.add(
        WatchlistItem(
            kind="movie",
            tmdb_id=50,
            media_type="movie",
            title="Queue Me",
            library_item_id=lib.id,
            list_section="to_watch",
        )
    )
    db.commit()

    pairs = _collect_unwatched_library(db, 0, admin.id)
    assert len(pairs) == 1
    assert pairs[0][0] == lib.id

    res = client.post("/api/watchlist/groups/0/queue-unwatched")
    assert res.status_code == 200
    body = res.json()
    assert body["eligible"] == 1
