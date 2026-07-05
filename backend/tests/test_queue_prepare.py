import asyncio
import threading
import time

from app.models import LibraryItem, QueueItem
from app.playqueue.manager import QueueManager


def _seed_library_item(db, path: str, title: str) -> None:
    db.add(LibraryItem(path=path, filename=title, title=title, folder="movies"))
    db.commit()


def _seed_queue(db, mgr: QueueManager, paths: list[str]) -> list[int]:
    for p in paths:
        asyncio.run(mgr.add_path(p, p))
    return [i["id"] for i in mgr.snapshot()["items"]]


# ---------------------------------------------------------------------------
# Snapshot / status plumbing
# ---------------------------------------------------------------------------


def test_snapshot_carries_default_empty_prepare_status(db):
    mgr = QueueManager()
    asyncio.run(mgr.add_path("/a.mkv", "A"))
    items = mgr.snapshot()["items"]
    assert items[0]["prepare_status"] == ""


def test_prepare_item_without_library_entry_is_ready_immediately(db, monkeypatch):
    import app.playqueue.manager as pq_manager

    called = []
    monkeypatch.setattr(pq_manager, "build_playback_file",
                        lambda lib: called.append(lib.path) or lib.path)

    async def scenario():
        mgr = QueueManager()
        await mgr.add_path("/no-library-entry.mkv", "Raw")
        item_id = mgr.snapshot()["items"][0]["id"]
        await mgr.prepare_item(item_id)
        return mgr.snapshot()

    snap = asyncio.run(scenario())
    assert snap["items"][0]["prepare_status"] == "ready"
    assert called == [], "no remux should run for a raw path without a library entry"


# ---------------------------------------------------------------------------
# prepare_all
# ---------------------------------------------------------------------------


def test_prepare_all_marks_all_ready(db, monkeypatch):
    import app.playqueue.manager as pq_manager

    built = []
    monkeypatch.setattr(pq_manager, "build_playback_file",
                        lambda lib: built.append(lib.path) or lib.path)

    paths = ["/a.mkv", "/b.mkv", "/c.mkv"]
    for p in paths:
        _seed_library_item(db, p, p)

    async def scenario():
        mgr = QueueManager()
        for p in paths:
            await mgr.add_path(p, p)
        await mgr.prepare_all()
        await asyncio.gather(*mgr._prepare_tasks.values())
        return mgr.snapshot()

    snap = asyncio.run(scenario())
    assert [i["prepare_status"] for i in snap["items"]] == ["ready"] * 3
    assert sorted(built) == paths


def test_prepare_all_runs_remuxes_serially(db, monkeypatch):
    import app.playqueue.manager as pq_manager

    state = {"active": 0, "max": 0}
    guard = threading.Lock()

    def fake_build(lib):
        with guard:
            state["active"] += 1
            state["max"] = max(state["max"], state["active"])
        time.sleep(0.05)
        with guard:
            state["active"] -= 1
        return lib.path

    monkeypatch.setattr(pq_manager, "build_playback_file", fake_build)

    paths = ["/a.mkv", "/b.mkv", "/c.mkv"]
    for p in paths:
        _seed_library_item(db, p, p)

    async def scenario():
        mgr = QueueManager()
        for p in paths:
            await mgr.add_path(p, p)
        await mgr.prepare_all()
        assert len(mgr._prepare_tasks) == 3
        await asyncio.gather(*mgr._prepare_tasks.values())
        return mgr.snapshot()

    snap = asyncio.run(scenario())
    assert [i["prepare_status"] for i in snap["items"]] == ["ready"] * 3
    assert state["max"] == 1, "background remuxes must never run concurrently"


def test_prepare_all_skips_already_ready_items(db, monkeypatch):
    import app.playqueue.manager as pq_manager

    built = []
    monkeypatch.setattr(pq_manager, "build_playback_file",
                        lambda lib: built.append(lib.path) or lib.path)

    _seed_library_item(db, "/a.mkv", "A")

    async def scenario():
        mgr = QueueManager()
        await mgr.add_path("/a.mkv", "A")
        await mgr.prepare_all()
        await asyncio.gather(*mgr._prepare_tasks.values())
        first_count = len(built)
        await mgr.prepare_all()  # everything already ready — no new tasks
        await asyncio.gather(*mgr._prepare_tasks.values())
        return first_count

    first_count = asyncio.run(scenario())
    assert first_count == 1
    assert len(built) == 1, "ready items must not be re-remuxed by prepare_all"


# ---------------------------------------------------------------------------
# Failure and cleanup paths
# ---------------------------------------------------------------------------


def test_prepare_failure_stores_failed_status_with_message(db, monkeypatch):
    import app.playqueue.manager as pq_manager

    def fake_build(lib):
        raise RuntimeError("boom")

    monkeypatch.setattr(pq_manager, "build_playback_file", fake_build)
    _seed_library_item(db, "/a.mkv", "A")

    async def scenario():
        mgr = QueueManager()
        await mgr.add_path("/a.mkv", "A")
        item_id = mgr.snapshot()["items"][0]["id"]
        await mgr.prepare_item(item_id)
        await asyncio.gather(*mgr._prepare_tasks.values())
        return mgr.snapshot()

    snap = asyncio.run(scenario())
    status = snap["items"][0]["prepare_status"]
    assert status.startswith("failed:")
    assert "boom" in status


def test_remove_drops_prepare_status(db, monkeypatch):
    import app.playqueue.manager as pq_manager

    monkeypatch.setattr(pq_manager, "build_playback_file", lambda lib: lib.path)
    _seed_library_item(db, "/a.mkv", "A")

    async def scenario():
        mgr = QueueManager()
        await mgr.add_path("/a.mkv", "A")
        item_id = mgr.snapshot()["items"][0]["id"]
        await mgr.prepare_item(item_id)
        await asyncio.gather(*mgr._prepare_tasks.values())
        assert mgr._prepare.get(item_id) == "ready"
        await mgr.remove(item_id)
        return mgr, item_id

    mgr, item_id = asyncio.run(scenario())
    assert item_id not in mgr._prepare
    assert item_id not in mgr._prepare_tasks


def test_clear_drops_all_prepare_state(db, monkeypatch):
    import app.playqueue.manager as pq_manager

    monkeypatch.setattr(pq_manager, "build_playback_file", lambda lib: lib.path)
    _seed_library_item(db, "/a.mkv", "A")

    async def scenario():
        mgr = QueueManager()
        await mgr.add_path("/a.mkv", "A")
        await mgr.prepare_all()
        await asyncio.gather(*mgr._prepare_tasks.values())
        await mgr.clear()
        return mgr

    mgr = asyncio.run(scenario())
    assert mgr._prepare == {}
    assert mgr._prepare_tasks == {}


# ---------------------------------------------------------------------------
# Same-item mutual exclusion (prepare vs play) — required by plan amendment
# ---------------------------------------------------------------------------


def test_same_item_prepare_and_play_never_remux_concurrently(db, monkeypatch):
    import app.playqueue.manager as pq_manager

    per_path: dict[str, int] = {}
    violations: list[str] = []
    guard = threading.Lock()

    def fake_build(lib):
        with guard:
            n = per_path.get(lib.path, 0) + 1
            per_path[lib.path] = n
            if n > 1:
                violations.append(lib.path)
        time.sleep(0.1)
        with guard:
            per_path[lib.path] -= 1
        return lib.path

    async def fake_aio(fn, *args):
        return {"media_state": "", "duration": 0, "cursor": 0}

    monkeypatch.setattr(pq_manager, "aio", fake_aio)
    monkeypatch.setattr(pq_manager, "build_playback_file", fake_build)

    _seed_library_item(db, "/a.mkv", "A")

    async def scenario():
        mgr = QueueManager()
        await mgr.add_path("/a.mkv", "A")
        item_id = mgr.snapshot()["items"][0]["id"]
        await mgr.prepare_item(item_id)
        # Race the play of the same item against its in-flight prepare.
        await asyncio.gather(mgr.play_index(0), *mgr._prepare_tasks.values())
        return mgr, item_id

    mgr, item_id = asyncio.run(scenario())
    assert violations == [], "prepare and play remuxed the same file concurrently"
    assert mgr._prepare.get(item_id) == "ready"


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


def test_prepare_all_route_returns_snapshot_with_statuses(client, db):
    from app.playqueue.manager import manager

    manager._prepare.clear()
    manager._prepare_tasks.clear()
    # Raw path with no LibraryItem — becomes "ready" synchronously.
    db.add(QueueItem(library_path="/nolib/movie.mkv", title="Movie", position=0))
    db.commit()

    try:
        res = client.post("/api/queue/prepare")
        assert res.status_code == 200
        items = res.json()["items"]
        assert len(items) == 1
        assert items[0]["prepare_status"] == "ready"
    finally:
        manager._prepare.clear()
        manager._prepare_tasks.clear()


def test_prepare_single_item_route(client, db):
    from app.playqueue.manager import manager

    manager._prepare.clear()
    manager._prepare_tasks.clear()
    db.add(QueueItem(library_path="/nolib/movie.mkv", title="Movie", position=0))
    db.commit()
    item_id = manager.snapshot()["items"][0]["id"]

    try:
        res = client.post(f"/api/queue/{item_id}/prepare")
        assert res.status_code == 200
        items = res.json()["items"]
        assert items[0]["prepare_status"] == "ready"
    finally:
        manager._prepare.clear()
        manager._prepare_tasks.clear()


def test_prepare_unknown_item_route_404(client, db):
    res = client.post("/api/queue/999999/prepare")
    assert res.status_code == 404
