import asyncio
import os

from app import events as events_module
from app.auth import CurrentUser, hash_password
from app.models import AppEvent, LibraryItem, QueueItem, User


def test_recorder_never_raises(db, monkeypatch):
    class _BoomSessionLocal:
        def __call__(self):
            raise RuntimeError("db is broken")

    monkeypatch.setattr(events_module, "SessionLocal", _BoomSessionLocal())
    result = events_module.record_event("queue_add", "Some Title")
    assert result is None


def test_recorder_writes_row_with_user(db):
    user = CurrentUser(id=1, username="admin", role="admin")
    result = events_module.record_event("queue_add", "My Movie", user=user)
    assert result is not None
    assert result["kind"] == "queue_add"
    assert result["title"] == "My Movie"
    assert result["username"] == "admin"
    assert result["user_id"] == 1

    rows = db.query(AppEvent).all()
    assert len(rows) == 1
    assert rows[0].kind == "queue_add"


def test_recorder_writes_row_without_user(db):
    result = events_module.record_event("auto_skip", "Corrupt File", detail="media error")
    assert result is not None
    assert result["user_id"] is None
    assert result["username"] == ""
    assert result["detail"] == "media error"


def test_recorder_broadcasts_activity_event(db, monkeypatch):
    seen = []
    monkeypatch.setattr(
        events_module.hub, "broadcast_threadsafe", lambda event, data: seen.append((event, data))
    )
    events_module.record_event("queue_add", "Broadcast Test")
    assert len(seen) == 1
    assert seen[0][0] == "activity_event"
    assert seen[0][1]["title"] == "Broadcast Test"


# ---------------------------------------------------------------------------
# Instrumented call sites (API-level)
# ---------------------------------------------------------------------------


def test_queue_add_records_event_with_username(client, db):
    lib = LibraryItem(path="/movies/a.mkv", filename="a.mkv", title="A Movie", folder="torrents")
    db.add(lib)
    db.commit()
    db.refresh(lib)

    res = client.post("/api/queue/add", json={"library_id": lib.id})
    assert res.status_code == 200

    item = db.query(QueueItem).filter(QueueItem.library_path == "/movies/a.mkv").first()
    assert item is not None
    assert item.queued_by == "admin"
    assert item.queued_by_user_id is not None

    events = db.query(AppEvent).filter(AppEvent.kind == "queue_add").all()
    assert len(events) == 1
    assert events[0].username == "admin"
    assert events[0].title == "A Movie"


def test_queue_snapshot_includes_queued_by(client, db):
    lib = LibraryItem(path="/movies/b.mkv", filename="b.mkv", title="B Movie", folder="torrents")
    db.add(lib)
    db.commit()
    db.refresh(lib)

    client.post("/api/queue/add", json={"library_id": lib.id})
    res = client.get("/api/queue")
    assert res.status_code == 200
    items = res.json()["items"]
    assert len(items) == 1
    assert items[0]["queued_by"] == "admin"


def test_auto_advance_records_auto_skip_event(db):
    import app.playqueue.manager as pq_manager

    async def fake_aio(fn, *args):
        return {"media_state": "", "duration": 0, "cursor": 0}

    def fake_build(lib):
        return lib.path

    lib_a = LibraryItem(path="/a.mkv", filename="a.mkv", title="A", folder="torrents")
    lib_b = LibraryItem(path="/b.mkv", filename="b.mkv", title="B", folder="torrents")
    db.add_all([lib_a, lib_b])
    db.commit()

    orig_aio = pq_manager.aio
    orig_build = pq_manager.build_playback_file
    pq_manager.aio = fake_aio
    pq_manager.build_playback_file = fake_build
    try:
        mgr = pq_manager.QueueManager()
        asyncio.run(mgr.add_path("/a.mkv", "A"))
        asyncio.run(mgr.add_path("/b.mkv", "B"))
        mgr._set_current_index(0)
        mgr._ignore_end_until = 0

        asyncio.run(mgr._auto_advance("media error"))
    finally:
        pq_manager.aio = orig_aio
        pq_manager.build_playback_file = orig_build

    events = db.query(AppEvent).filter(AppEvent.kind == "auto_skip").all()
    assert len(events) == 1
    assert events[0].title == "A"
    assert events[0].detail == "media error"
    assert events[0].user_id is None


def test_events_endpoint_returns_newest_first_with_pagination(client, db):
    for i in range(5):
        events_module.record_event("queue_add", f"Title {i}")

    res = client.get("/api/events?limit=2")
    assert res.status_code == 200
    body = res.json()
    assert len(body["events"]) == 2
    assert body["has_more"] is True
    titles = [e["title"] for e in body["events"]]
    assert titles == ["Title 4", "Title 3"]

    before_id = body["events"][-1]["id"]
    res2 = client.get(f"/api/events?limit=2&before_id={before_id}")
    body2 = res2.json()
    titles2 = [e["title"] for e in body2["events"]]
    assert titles2 == ["Title 2", "Title 1"]


def test_login_records_event(client, db):
    user = User(username="loginuser", password_hash=hash_password("test123"), role="member")
    db.add(user)
    db.commit()

    res = client.post("/api/login", json={"username": "loginuser", "password": "test123"})
    assert res.status_code == 200

    events = db.query(AppEvent).filter(AppEvent.kind == "login").all()
    assert len(events) == 1
    assert events[0].title == "loginuser"


def test_library_delete_records_event(client, db, tmp_path):
    media = tmp_path / "deleteme.mkv"
    media.write_text("fake")
    lib = LibraryItem(path=str(media), filename="deleteme.mkv", title="Delete Me", folder="torrents")
    db.add(lib)
    db.commit()
    db.refresh(lib)

    res = client.delete(f"/api/library/{lib.id}")
    assert res.status_code == 200
    assert not os.path.exists(media)

    events = db.query(AppEvent).filter(AppEvent.kind == "library_delete").all()
    assert len(events) == 1
    assert events[0].title == "Delete Me"
    assert events[0].username == "admin"
