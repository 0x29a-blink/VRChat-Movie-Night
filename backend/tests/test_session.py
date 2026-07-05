from app.models import LibraryItem, WatchlistItem


def _seed_library_item(db, path="/movies/pick.mkv", title="Pick Me") -> LibraryItem:
    lib = LibraryItem(path=path, filename="pick.mkv", title=title, folder="torrents")
    db.add(lib)
    db.flush()
    return lib


def _seed_watchlist_item(db, *, library_item_id=None, title="Session Movie") -> WatchlistItem:
    item = WatchlistItem(
        kind="movie",
        title=title,
        media_type="movie",
        library_item_id=library_item_id,
        list_section="to_watch",
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def test_current_with_no_session_returns_active_null(client, db):
    res = client.get("/api/session/current")
    assert res.status_code == 200
    assert res.json() == {"active": None}


def test_start_creates_session_and_current_returns_it(client, db):
    res = client.post("/api/session/start", json={})
    assert res.status_code == 200
    body = res.json()
    assert body["state"] == "picking"
    assert body["group_id"] is None

    cur = client.get("/api/session/current")
    assert cur.status_code == 200
    assert cur.json()["active"]["id"] == body["id"]
    assert cur.json()["active"]["state"] == "picking"


def test_second_start_returns_409(client, db):
    res1 = client.post("/api/session/start", json={})
    assert res1.status_code == 200
    res2 = client.post("/api/session/start", json={})
    assert res2.status_code == 409


def test_pick_with_unlinked_item_returns_200_needs_download(client, db):
    client.post("/api/session/start", json={})
    item = _seed_watchlist_item(db, library_item_id=None)

    res = client.post("/api/session/pick", json={"watchlist_item_id": item.id})
    assert res.status_code == 200
    body = res.json()
    assert body["watchlist_item_id"] == item.id
    assert body["library_item_id"] is None
    assert body["needs_download"] is True
    assert body["state"] == "picking"


def test_queue_with_unlinked_pick_still_returns_400(client, db):
    client.post("/api/session/start", json={})
    item = _seed_watchlist_item(db, library_item_id=None)
    client.post("/api/session/pick", json={"watchlist_item_id": item.id})

    res = client.post("/api/session/queue")
    assert res.status_code == 400


def test_lazy_sync_picks_up_link_and_allows_queueing(client, db):
    client.post("/api/session/start", json={})
    item = _seed_watchlist_item(db, library_item_id=None)

    pick_res = client.post("/api/session/pick", json={"watchlist_item_id": item.id})
    assert pick_res.status_code == 200
    assert pick_res.json()["needs_download"] is True

    # Simulate the auto-link pipeline completing a download for this item.
    lib = _seed_library_item(db)
    item.library_item_id = lib.id
    db.commit()

    cur = client.get("/api/session/current")
    assert cur.status_code == 200
    active = cur.json()["active"]
    assert active["needs_download"] is False
    assert active["library_item_id"] == lib.id
    assert active["library_item_title"]
    assert active["library_path"] == lib.path

    queue_res = client.post("/api/session/queue")
    assert queue_res.status_code == 200
    assert queue_res.json()["state"] == "queued"


def test_pick_then_queue_reaches_queued_state_with_library_item(client, db):
    client.post("/api/session/start", json={})
    lib = _seed_library_item(db)
    item = _seed_watchlist_item(db, library_item_id=lib.id)
    db.commit()

    pick_res = client.post("/api/session/pick", json={"watchlist_item_id": item.id})
    assert pick_res.status_code == 200
    assert pick_res.json()["watchlist_item_id"] == item.id
    assert pick_res.json()["library_item_id"] == lib.id
    assert pick_res.json()["state"] == "picking"  # queue endpoint sets "queued", not pick

    queue_res = client.post("/api/session/queue")
    assert queue_res.status_code == 200
    assert queue_res.json()["state"] == "queued"

    snap = client.get("/api/queue").json()
    assert any(i["library_path"] == lib.path for i in snap["items"])


def test_queue_without_pick_returns_400(client, db):
    client.post("/api/session/start", json={})
    res = client.post("/api/session/queue")
    assert res.status_code == 400


def test_invalid_advance_transition_returns_400(client, db):
    client.post("/api/session/start", json={})
    # still "picking" — advance to "playing" is not allowed until "queued"
    res = client.post("/api/session/advance", json={"state": "playing"})
    assert res.status_code == 400


def test_valid_advance_transitions(client, db):
    client.post("/api/session/start", json={})
    lib = _seed_library_item(db)
    item = _seed_watchlist_item(db, library_item_id=lib.id)
    db.commit()
    client.post("/api/session/pick", json={"watchlist_item_id": item.id})
    client.post("/api/session/queue")

    res = client.post("/api/session/advance", json={"state": "playing"})
    assert res.status_code == 200
    assert res.json()["state"] == "playing"

    res2 = client.post("/api/session/advance", json={"state": "rating"})
    assert res2.status_code == 200
    assert res2.json()["state"] == "rating"


def test_end_sets_ended_state_and_current_returns_null(client, db):
    client.post("/api/session/start", json={})
    res = client.post("/api/session/end")
    assert res.status_code == 200
    assert res.json()["state"] == "ended"
    assert res.json()["ended_at"] is not None

    cur = client.get("/api/session/current")
    assert cur.json() == {"active": None}


def test_end_without_active_session_returns_404(client, db):
    res = client.post("/api/session/end")
    assert res.status_code == 404


def test_full_lifecycle_broadcasts_session_update(client, db, monkeypatch):
    import app.routers.session_routes as session_routes

    broadcasts = []

    async def fake_broadcast(event, data):
        broadcasts.append((event, data))

    monkeypatch.setattr(session_routes.hub, "broadcast", fake_broadcast)

    lib = _seed_library_item(db)
    item = _seed_watchlist_item(db, library_item_id=lib.id)
    db.commit()

    client.post("/api/session/start", json={})
    client.post("/api/session/pick", json={"watchlist_item_id": item.id})
    client.post("/api/session/queue")
    client.post("/api/session/advance", json={"state": "playing"})
    client.post("/api/session/advance", json={"state": "rating"})
    client.post("/api/session/end")

    session_events = [b for b in broadcasts if b[0] == "session_update"]
    # start, pick, queue, advance x2, end == 6 mutations
    assert len(session_events) == 6
    states_seen = [b[1]["state"] for b in session_events]
    assert states_seen == ["picking", "picking", "queued", "playing", "rating", "ended"]
