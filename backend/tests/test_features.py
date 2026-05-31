import json

from app.models import User, WatchlistGroup, WatchlistItem, WheelPreset


def test_preflight_authenticated(client, db):
    res = client.get("/api/health/preflight")
    assert res.status_code == 200
    data = res.json()
    assert data["api"] is True
    assert "obs_connected" in data
    assert "mediamtx_running" in data
    assert "hls_url" in data
    assert ":8888/live/vrstream/index.m3u8" in data["hls_url"]
    assert data["users"] >= 1
    assert "tools" in data
    assert "issues" in data
    assert "checklist_ok" in data


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

    res = client.post("/api/backup/import", json={"data": payload})
    assert res.status_code == 200
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
