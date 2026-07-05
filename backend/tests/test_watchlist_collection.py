from unittest.mock import AsyncMock, patch

from app.models import WatchlistItem

MOCK_COLLECTION = {
    "collection_id": 86311,
    "name": "The Avengers Collection",
    "overview": "Marvel heroes assemble.",
    "poster": "https://example.com/poster.jpg",
    "movies": [
        {
            "tmdb_id": 24428,
            "title": "The Avengers",
            "year": "2012",
            "poster": "https://example.com/a1.jpg",
            "overview": "First team-up.",
            "type": "movie",
        },
        {
            "tmdb_id": 99861,
            "title": "Avengers: Age of Ultron",
            "year": "2015",
            "poster": "https://example.com/a2.jpg",
            "overview": "Ultron rises.",
            "type": "movie",
        },
    ],
}


@patch("app.routers.watchlist_routes.tmdb.collection_movies", new_callable=AsyncMock)
def test_add_collection_imports_movies_as_children(mock_fetch, client):
    mock_fetch.return_value = MOCK_COLLECTION

    res = client.post(
        "/api/watchlist/items",
        json={
            "kind": "collection",
            "tmdb_id": 86311,
            "title": "The Avengers Collection",
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["kind"] == "collection"
    assert body["title"] == "The Avengers Collection"
    assert len(body["children"]) == 2
    assert body["children"][0]["kind"] == "movie"
    assert body["children"][0]["parent_id"] == body["id"]
    assert body["children"][1]["tmdb_id"] == 99861


@patch("app.routers.watchlist_routes.tmdb.collection_movies", new_callable=AsyncMock)
def test_add_collection_dedupes_per_group(mock_fetch, client, db):
    mock_fetch.return_value = MOCK_COLLECTION

    first = client.post(
        "/api/watchlist/items",
        json={"kind": "collection", "tmdb_id": 86311, "group_id": None},
    )
    assert first.status_code == 200
    first_id = first.json()["id"]

    second = client.post(
        "/api/watchlist/items",
        json={"kind": "collection", "tmdb_id": 86311, "group_id": None},
    )
    assert second.status_code == 200
    assert second.json()["id"] == first_id
    assert mock_fetch.call_count == 1

    roots = db.query(WatchlistItem).filter(WatchlistItem.parent_id.is_(None)).all()
    assert len(roots) == 1


@patch("app.routers.watchlist_routes.tmdb.collection_movies", new_callable=AsyncMock)
def test_collection_counts_as_one_wheel_candidate(mock_fetch, client, db):
    mock_fetch.return_value = MOCK_COLLECTION
    add = client.post("/api/watchlist/items", json={"kind": "collection", "tmdb_id": 86311})
    assert add.status_code == 200

    grp = client.post("/api/watchlist/groups", json={"name": "Movie Night"})
    group_id = grp.json()["id"]
    client.patch(f"/api/watchlist/groups/{group_id}", json={"wheel_enabled": True})

    collection = db.query(WatchlistItem).filter(WatchlistItem.kind == "collection").one()
    collection.group_id = group_id
    for child in db.query(WatchlistItem).filter(WatchlistItem.parent_id == collection.id):
        child.group_id = group_id
    db.commit()

    spin = client.post(f"/api/watchlist/groups/{group_id}/wheel", json={})
    assert spin.status_code == 200
    assert spin.json()["item"]["kind"] == "collection"
    assert len(spin.json()["candidates"]) == 1
