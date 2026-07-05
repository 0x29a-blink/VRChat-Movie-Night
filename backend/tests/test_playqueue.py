import asyncio

from app.models import LibraryItem
from app.playqueue.manager import QueueManager

# ---------------------------------------------------------------------------
# Step 1: pure-logic static helpers (no mocks, no fixtures)
# ---------------------------------------------------------------------------


def test_ended_looks_natural_near_end():
    status = {"media_state": "OBS_MEDIA_STATE_ENDED", "duration": 100000, "cursor": 99000}
    assert QueueManager._ended_looks_natural(status) is True


def test_ended_looks_natural_ratio_rule():
    status = {"media_state": "OBS_MEDIA_STATE_ENDED", "duration": 100000, "cursor": 95000}
    assert QueueManager._ended_looks_natural(status) is True


def test_ended_looks_natural_false_when_far_from_end():
    status = {"media_state": "OBS_MEDIA_STATE_ENDED", "duration": 100000, "cursor": 10000}
    assert QueueManager._ended_looks_natural(status) is False


def test_ended_looks_natural_false_when_not_ended():
    status = {"media_state": "OBS_MEDIA_STATE_PLAYING", "duration": 100000, "cursor": 99000}
    assert QueueManager._ended_looks_natural(status) is False


def test_ended_looks_natural_false_when_duration_zero():
    status = {"media_state": "OBS_MEDIA_STATE_ENDED", "duration": 0, "cursor": 0}
    assert QueueManager._ended_looks_natural(status) is False


def test_ended_looks_broken_zero_duration():
    status = {"media_state": "OBS_MEDIA_STATE_ENDED", "duration": 0, "cursor": 0}
    assert QueueManager._ended_looks_broken(status) is True


def test_ended_looks_broken_small_cursor():
    status = {"media_state": "OBS_MEDIA_STATE_ENDED", "duration": 100000, "cursor": 1000}
    assert QueueManager._ended_looks_broken(status) is True


def test_ended_looks_broken_false_mid_timeline():
    status = {"media_state": "OBS_MEDIA_STATE_ENDED", "duration": 100000, "cursor": 50000}
    assert QueueManager._ended_looks_broken(status) is False


def test_ended_looks_broken_false_when_not_ended():
    status = {"media_state": "OBS_MEDIA_STATE_PLAYING", "duration": 0, "cursor": 0}
    assert QueueManager._ended_looks_broken(status) is False


def test_stall_timeout_sec_zero_duration():
    assert QueueManager._stall_timeout_sec(0) == 20.0


def test_stall_timeout_sec_negative_duration():
    assert QueueManager._stall_timeout_sec(-5) == 20.0


def test_stall_timeout_sec_positive_duration():
    assert QueueManager._stall_timeout_sec(60000) == 45.0


def test_cursor_moved_prev_none():
    assert QueueManager._cursor_moved(None, 0) is True


def test_cursor_moved_same_value():
    assert QueueManager._cursor_moved(5, 5) is False


def test_cursor_moved_different_value():
    assert QueueManager._cursor_moved(5, 6) is True


# ---------------------------------------------------------------------------
# Step 2: DB-backed queue mutation tests
# ---------------------------------------------------------------------------


def test_add_path_twice_orders_by_position(db):
    mgr = QueueManager()
    asyncio.run(mgr.add_path("/a.mkv", "A"))
    asyncio.run(mgr.add_path("/b.mkv", "B"))
    snap = mgr.snapshot()
    items = snap["items"]
    assert [i["library_path"] for i in items] == ["/a.mkv", "/b.mkv"]
    assert [i["position"] for i in items] == [0, 1]


def test_remove_before_current_decrements_index(db):
    mgr = QueueManager()
    asyncio.run(mgr.add_path("/a.mkv", "A"))
    asyncio.run(mgr.add_path("/b.mkv", "B"))
    asyncio.run(mgr.add_path("/c.mkv", "C"))
    items = mgr.snapshot()["items"]
    mgr._set_current_index(2)  # points at C
    asyncio.run(mgr.remove(items[0]["id"]))  # remove A (before current)
    assert mgr._current_index() == 1


def test_remove_after_current_leaves_index_unchanged(db):
    mgr = QueueManager()
    asyncio.run(mgr.add_path("/a.mkv", "A"))
    asyncio.run(mgr.add_path("/b.mkv", "B"))
    asyncio.run(mgr.add_path("/c.mkv", "C"))
    items = mgr.snapshot()["items"]
    mgr._set_current_index(0)  # points at A
    asyncio.run(mgr.remove(items[2]["id"]))  # remove C (after current)
    assert mgr._current_index() == 0


def test_reorder_keeps_pointer_on_same_item_case1(db):
    mgr = QueueManager()
    asyncio.run(mgr.add_path("/a.mkv", "A"))
    asyncio.run(mgr.add_path("/b.mkv", "B"))
    asyncio.run(mgr.add_path("/c.mkv", "C"))
    items = mgr.snapshot()["items"]
    a_id, b_id, c_id = (i["id"] for i in items)
    mgr._set_current_index(1)  # points at B

    asyncio.run(mgr.reorder([c_id, b_id, a_id]))
    assert mgr._current_index() == 1  # B's new slot


def test_reorder_keeps_pointer_on_same_item_case2(db):
    mgr = QueueManager()
    asyncio.run(mgr.add_path("/a.mkv", "A"))
    asyncio.run(mgr.add_path("/b.mkv", "B"))
    asyncio.run(mgr.add_path("/c.mkv", "C"))
    items = mgr.snapshot()["items"]
    a_id, b_id, c_id = (i["id"] for i in items)
    mgr._set_current_index(1)  # points at B

    asyncio.run(mgr.reorder([b_id, a_id, c_id]))
    assert mgr._current_index() == 0


def test_clear_resets_index_and_empties_items(db):
    mgr = QueueManager()
    asyncio.run(mgr.add_path("/a.mkv", "A"))
    mgr._set_current_index(0)
    asyncio.run(mgr.clear())
    assert mgr._current_index() == -1
    assert mgr.snapshot()["items"] == []


def test_snapshot_clamps_stale_out_of_range_index(db):
    mgr = QueueManager()
    asyncio.run(mgr.add_path("/a.mkv", "A"))
    mgr._set_current_index(5)
    snap = mgr.snapshot()
    assert snap["current_index"] == -1
    assert snap["current"] is None


# ---------------------------------------------------------------------------
# Step 3: auto-advance behavior tests (monkeypatched OBS)
# ---------------------------------------------------------------------------


def _seed_library_item(db, path: str, title: str) -> None:
    db.add(LibraryItem(path=path, filename=title, title=title, folder="movies"))
    db.commit()


def test_next_wraps_to_index_zero_when_loop_enabled(db, monkeypatch):
    import app.playqueue.manager as pq_manager

    played = []

    async def fake_aio(fn, *args):
        if args:  # only play_file(path) passes an arg; status() calls take none
            played.append(args)
        return {"media_state": "", "duration": 0, "cursor": 0}

    monkeypatch.setattr(pq_manager, "aio", fake_aio)
    monkeypatch.setattr(pq_manager, "build_playback_file", lambda lib: lib.path)

    _seed_library_item(db, "/a.mkv", "A")
    _seed_library_item(db, "/b.mkv", "B")

    mgr = QueueManager()
    asyncio.run(mgr.add_path("/a.mkv", "A"))
    asyncio.run(mgr.add_path("/b.mkv", "B"))
    mgr._set_current_index(1)  # last index

    asyncio.run(mgr.next())

    assert mgr._current_index() == 0
    assert played, "expected a play call to have been recorded"
    assert played[-1] == ("/a.mkv",)


def test_next_no_wrap_when_loop_disabled(db, monkeypatch):
    import app.playqueue.manager as pq_manager
    from app import settings_store

    played = []

    async def fake_aio(fn, *args):
        played.append(args)
        return {"media_state": "", "duration": 0, "cursor": 0}

    monkeypatch.setattr(pq_manager, "aio", fake_aio)
    monkeypatch.setattr(pq_manager, "build_playback_file", lambda lib: lib.path)

    _seed_library_item(db, "/a.mkv", "A")
    _seed_library_item(db, "/b.mkv", "B")

    settings_store.set_value("queue_loop", False)

    mgr = QueueManager()
    asyncio.run(mgr.add_path("/a.mkv", "A"))
    asyncio.run(mgr.add_path("/b.mkv", "B"))
    mgr._set_current_index(1)  # last index

    before = mgr.snapshot()
    asyncio.run(mgr.next())
    after = mgr.snapshot()

    assert after == before
    assert not played, "no play call should have been recorded"


def test_auto_advance_debounces_back_to_back_calls(db, monkeypatch):
    import app.playqueue.manager as pq_manager

    played = []

    async def fake_aio(fn, *args):
        if args:  # only play_file(path) passes an arg; status() calls take none
            played.append(args)
        return {"media_state": "", "duration": 0, "cursor": 0}

    monkeypatch.setattr(pq_manager, "aio", fake_aio)
    monkeypatch.setattr(pq_manager, "build_playback_file", lambda lib: lib.path)

    _seed_library_item(db, "/a.mkv", "A")
    _seed_library_item(db, "/b.mkv", "B")

    mgr = QueueManager()
    asyncio.run(mgr.add_path("/a.mkv", "A"))
    asyncio.run(mgr.add_path("/b.mkv", "B"))
    mgr._set_current_index(0)
    mgr._ignore_end_until = 0

    asyncio.run(mgr._auto_advance("playback ended"))
    asyncio.run(mgr._auto_advance("playback ended"))

    assert len(played) == 1, "second back-to-back call should be a debounced no-op"


def test_poll_playback_end_broken_at_start_warns_and_advances(db, monkeypatch):
    import app.playqueue.manager as pq_manager

    broadcasts = []

    async def fake_broadcast(event, data):
        broadcasts.append((event, data))

    async def fake_aio(fn, *args):
        return {"media_state": "OBS_MEDIA_STATE_ENDED", "duration": 0, "cursor": 0}

    monkeypatch.setattr(pq_manager, "aio", fake_aio)
    monkeypatch.setattr(pq_manager, "build_playback_file", lambda lib: lib.path)
    monkeypatch.setattr(pq_manager.hub, "broadcast", fake_broadcast)

    _seed_library_item(db, "/a.mkv", "A")
    _seed_library_item(db, "/b.mkv", "B")

    mgr = QueueManager()
    asyncio.run(mgr.add_path("/a.mkv", "A"))
    asyncio.run(mgr.add_path("/b.mkv", "B"))
    mgr._set_current_index(0)
    mgr._ignore_end_until = 0
    mgr._last_media_state = ""  # force a fresh transition into ENDED

    asyncio.run(mgr.poll_playback_end())

    warning_events = [b for b in broadcasts if b[0] == "player_warning"]
    assert warning_events, "expected a player_warning broadcast for the broken-ended path"
