import json

from app.library.matching import find_library_by_tmdb, find_library_for_watchlist_item
from app.models import LibraryItem, WatchlistGroup, WatchlistItem


def test_library_delete_clears_watchlist_link(db, tmp_path):
    lib_path = tmp_path / "movie.mkv"
    lib_path.write_text("fake")

    lib = LibraryItem(
        path=str(lib_path),
        filename="movie.mkv",
        title="Movie",
        folder="torrents",
        tmdb_id=123,
        media_type="movie",
    )
    db.add(lib)
    db.flush()

    item = WatchlistItem(
        kind="movie",
        tmdb_id=123,
        media_type="movie",
        title="Movie",
        library_item_id=lib.id,
    )
    db.add(item)
    db.commit()

    item_id = lib.id
    db.query(WatchlistItem).filter(WatchlistItem.library_item_id == item_id).update(
        {WatchlistItem.library_item_id: None},
        synchronize_session=False,
    )
    db.delete(lib)
    db.commit()

    db.refresh(item)
    assert item.library_item_id is None


def test_find_library_by_tmdb_episode(db, tmp_path):
    lib_path = tmp_path / "ep.mkv"
    lib_path.write_text("fake")

    lib = LibraryItem(
        path=str(lib_path),
        filename="ep.mkv",
        title="Show S01E02",
        folder="torrents",
        tmdb_id=99,
        media_type="series",
        season=1,
        episode=2,
    )
    db.add(lib)
    db.commit()

    found = find_library_by_tmdb(db, 99, "series", 1, 2)
    assert found is not None
    assert found.id == lib.id


def test_episode_watchlist_item_gets_library_match(db, tmp_path):
    lib_path = tmp_path / "ep.mkv"
    lib_path.write_text("fake")

    lib = LibraryItem(
        path=str(lib_path),
        filename="ep.mkv",
        title="Show S01E02",
        folder="torrents",
        tmdb_id=42,
        media_type="series",
        season=1,
        episode=2,
    )
    db.add(lib)
    db.commit()

    item = WatchlistItem(
        kind="episode",
        tmdb_id=42,
        media_type="series",
        season=1,
        episode=2,
        title="Show S01E02",
    )
    match = find_library_for_watchlist_item(db, item)
    assert match is not None
    assert match["id"] == lib.id


def test_stats_group_filter(client, db):
    grp = WatchlistGroup(name="Horror", sort_order=0)
    db.add(grp)
    db.flush()

    db.add(
        WatchlistItem(
            kind="movie",
            title="In group",
            group_id=grp.id,
            tmdb_id=1,
            media_type="movie",
        )
    )
    db.add(
        WatchlistItem(
            kind="movie",
            title="Ungrouped",
            group_id=None,
            tmdb_id=2,
            media_type="movie",
        )
    )
    db.commit()

    all_stats = client.get("/api/stats").json()
    horror_stats = client.get(f"/api/stats?group_id={grp.id}").json()

    assert all_stats["overview"]["total_titles"] == 2
    assert horror_stats["group_name"] == "Horror"
    assert horror_stats["overview"]["total_titles"] == 1


def test_library_match_endpoint(client, db, tmp_path):
    lib_path = tmp_path / "movie.mkv"
    lib_path.write_text("fake")

    db.add(
        LibraryItem(
            path=str(lib_path),
            filename="movie.mkv",
            title="Dune",
            folder="torrents",
            tmdb_id=438631,
            media_type="movie",
        )
    )
    db.commit()

    res = client.get("/api/library/match?tmdb_id=438631&media_type=movie")
    assert res.status_code == 200
    assert res.json()["match"]["title"] == "Dune"


def test_backup_export_admin(client, db):
    db.add(WatchlistItem(kind="movie", title="Backup me", tmdb_id=5, media_type="movie"))
    db.commit()

    res = client.get("/api/backup/export")
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("application/json")

    payload = json.loads(res.content)
    assert "watchlist_items" in payload
    assert any(i["title"] == "Backup me" for i in payload["watchlist_items"])
