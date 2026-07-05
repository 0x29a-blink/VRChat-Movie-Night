import json

from app.config import settings as env_settings
from app.models import WatchlistGroup, WatchlistItem, WheelPreset

VALID_PAYLOAD = {
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
    "watchlist_item_user_exclusions": [],
    "library_items": [],
    "wheel_presets": [{"id": 1, "name": "Genres", "labels": ["Horror", "Comedy"], "sort_order": 0}],
    "settings": {},
}


def _seed_watchlist(db):
    grp = WatchlistGroup(name="Original Group", sort_order=0)
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


# ---- Preview endpoint ----


def test_preview_valid_payload_reports_counts(client, db):
    res = client.post("/api/backup/import-preview", json={"data": VALID_PAYLOAD})
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert body["groups"] == 1
    assert body["items"] == 1
    assert body["wheel_presets"] == 1
    assert body["users_matched"] == 1
    assert body["users_unmatched"] == []


def test_preview_does_not_touch_db(client, db):
    _seed_watchlist(db)
    res = client.post("/api/backup/import-preview", json={"data": VALID_PAYLOAD})
    assert res.status_code == 200
    titles = [i.title for i in db.query(WatchlistItem).all()]
    assert "Old title" in titles
    assert "Restored Movie" not in titles


def test_preview_reports_unmatched_user(client, db):
    payload = dict(VALID_PAYLOAD)
    payload["users"] = [{"id": 1, "username": "ghost_user", "role": "member"}]
    res = client.post("/api/backup/import-preview", json={"data": payload})
    assert res.status_code == 200
    body = res.json()
    assert body["users_unmatched"] == ["ghost_user"]
    assert body["users_matched"] == 0


def test_preview_junk_sort_order_rejected(client, db):
    payload = json.loads(json.dumps(VALID_PAYLOAD))
    payload["watchlist_groups"][0]["sort_order"] = "abc"
    res = client.post("/api/backup/import-preview", json={"data": payload})
    assert res.status_code == 422
    errors = res.json()["detail"]["errors"]
    assert any("sort_order" in ".".join(str(p) for p in e["loc"]) for e in errors)


def test_preview_missing_users_key_defaults_empty(client, db):
    payload = json.loads(json.dumps(VALID_PAYLOAD))
    del payload["users"]
    res = client.post("/api/backup/import-preview", json={"data": payload})
    assert res.status_code == 200
    body = res.json()
    assert body["users_matched"] == 0
    assert body["users_unmatched"] == []


def test_preview_library_links_resolvable(client, db, tmp_path):
    from app.models import LibraryItem

    lib_path = tmp_path / "movie.mkv"
    lib_path.write_text("fake")
    lib = LibraryItem(path=str(lib_path), filename="movie.mkv", folder="torrents")
    db.add(lib)
    db.commit()

    payload = json.loads(json.dumps(VALID_PAYLOAD))
    payload["library_items"] = [
        {"id": 5, "path": str(lib_path), "filename": "movie.mkv"},
        {"id": 6, "path": "/nonexistent/path.mkv", "filename": "missing.mkv"},
    ]
    res = client.post("/api/backup/import-preview", json={"data": payload})
    assert res.status_code == 200
    body = res.json()
    assert body["library_items_total"] == 2
    assert body["library_links_resolvable"] == 1


def test_preview_wrong_version_rejected(client, db):
    payload = json.loads(json.dumps(VALID_PAYLOAD))
    payload["version"] = 2
    res = client.post("/api/backup/import-preview", json={"data": payload})
    assert res.status_code == 400


# ---- Import hardening ----


def test_import_malformed_payload_leaves_db_untouched(client, db):
    _seed_watchlist(db)
    payload = json.loads(json.dumps(VALID_PAYLOAD))
    payload["watchlist_groups"][0]["sort_order"] = "abc"

    res = client.post("/api/backup/import", json={"data": payload})
    assert res.status_code == 422

    titles = [i.title for i in db.query(WatchlistItem).all()]
    assert "Old title" in titles
    assert "Restored Movie" not in titles
    assert db.query(WatchlistGroup).count() == 1
    assert db.query(WatchlistGroup).first().name == "Original Group"


def test_import_wrong_version_leaves_db_untouched(client, db):
    _seed_watchlist(db)
    payload = json.loads(json.dumps(VALID_PAYLOAD))
    payload["version"] = 2

    res = client.post("/api/backup/import", json={"data": payload})
    assert res.status_code == 400

    titles = [i.title for i in db.query(WatchlistItem).all()]
    assert "Old title" in titles


def test_import_writes_pre_import_snapshot(client, db, tmp_path, monkeypatch):
    from app.models import User

    monkeypatch.setattr(env_settings, "data_dir", str(tmp_path))
    _seed_watchlist(db)

    # Seeded admin starts with watchlist_stats_excluded=False; the imported
    # payload flips it to True. The snapshot must record the PRE-import value.
    admin = db.query(User).filter(User.username == "admin").first()
    assert admin.watchlist_stats_excluded is False

    payload = json.loads(json.dumps(VALID_PAYLOAD))
    payload["users"] = [
        {"id": 1, "username": "admin", "role": "admin", "watchlist_stats_excluded": True}
    ]

    res = client.post("/api/backup/import", json={"data": payload})
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    snapshot_name = body["pre_import_snapshot"]
    assert snapshot_name.startswith("pre-import-")

    snapshot_path = tmp_path / "backups" / snapshot_name
    assert snapshot_path.exists()
    snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
    assert snapshot["version"] == 1
    # Snapshot captures PRE-import state (the "Original Group" watchlist), not the new one.
    snapshot_titles = [i["title"] for i in snapshot["watchlist_items"]]
    assert "Old title" in snapshot_titles
    # User flags in the snapshot are the pre-import values, not the backup's.
    snapshot_admin = next(u for u in snapshot["users"] if u["username"] == "admin")
    assert snapshot_admin["watchlist_stats_excluded"] is False
    # ...while the import itself applied the backup's value to the DB.
    db.expire_all()
    admin = db.query(User).filter(User.username == "admin").first()
    assert admin.watchlist_stats_excluded is True


def test_import_backup_replaces_watchlist_unchanged(client, db):
    """Existing round-trip behavior (extended with pre_import_snapshot key)."""
    _seed_watchlist(db)

    res = client.post("/api/backup/import", json={"data": VALID_PAYLOAD})
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert body["items"] == 1
    assert body["groups"] == 1
    assert body["wheel_presets"] == 1
    assert "pre_import_snapshot" in body

    titles = [i.title for i in db.query(WatchlistItem).all()]
    assert "Restored Movie" in titles
    assert "Old title" not in titles
    assert db.query(WheelPreset).count() == 1
