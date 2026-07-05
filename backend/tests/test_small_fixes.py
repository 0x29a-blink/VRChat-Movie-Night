import asyncio

from app.downloads.manager import DownloadManager
from app.torbox.client import pick_file_id

# --- Step 3: pick_file_id ----------------------------------------------------


def _f(id_: int, name: str, size: int) -> dict:
    return {"id": id_, "name": name, "size": size}


def test_pick_file_id_stale_index_falls_back_to_video():
    files = [_f(1, "movie.nfo", 10), _f(2, "movie.mkv", 5000)]
    assert pick_file_id({"files": files}, file_idx=0) == 2


def test_pick_file_id_index_honored_when_it_is_a_video():
    files = [_f(1, "movie.nfo", 10), _f(2, "movie.mkv", 5000)]
    assert pick_file_id({"files": files}, file_idx=1) == 2


def test_pick_file_id_index_honored_when_no_videos_exist():
    files = [_f(1, "movie.nfo", 10)]
    assert pick_file_id({"files": files}, file_idx=0) == 1


def test_pick_file_id_no_index_no_hint_picks_biggest_video():
    files = [_f(1, "small.mkv", 100), _f(2, "big.mkv", 999999)]
    assert pick_file_id({"files": files}, file_idx=None) == 2


def test_pick_file_id_filename_hint_wins_over_index():
    files = [_f(1, "small.mkv", 100), _f(2, "big.mkv", 999999)]
    # file_idx points at the big file, but the hint should still steer to "small".
    assert pick_file_id({"files": files}, file_idx=2, filename_hint="small") == 1


# --- Step 2: HLS no-output watchdog -----------------------------------------


class _FakeStdout:
    async def readline(self):
        await asyncio.sleep(3600)


class _FakeProc:
    def __init__(self):
        self.stdout = _FakeStdout()
        self.pid = 1234

    async def wait(self):
        return 1


def test_hls_watchdog_kills_stalled_ffmpeg(monkeypatch):
    from app.downloads import manager as dl_manager

    async def fake_create_subprocess_exec(*args, **kwargs):
        return _FakeProc()

    monkeypatch.setattr(dl_manager.asyncio, "create_subprocess_exec", fake_create_subprocess_exec)
    monkeypatch.setattr(dl_manager, "HLS_NO_OUTPUT_TIMEOUT_SEC", 0.1)

    killed = []
    monkeypatch.setattr(dl_manager, "_kill_tree", lambda pid: killed.append(pid))

    mgr = DownloadManager()
    rc, err = asyncio.run(
        mgr._run_ffmpeg_hls_pass(
            job_id="job-stall",
            target="https://example.test/stream.m3u8",
            referer="",
            out_path=__import__("pathlib").Path("out.mp4"),
            duration=0.0,
            est_bytes=0,
            mode="copy_va",
        )
    )

    assert rc == 1
    assert "no output" in err
    assert killed == [1234]


# --- Step 4: scanner parallel probing ---------------------------------------


def test_scan_folder_probes_new_files_and_removes_missing(db, tmp_path, monkeypatch):
    from app.library import scanner

    monkeypatch.setitem(scanner._FOLDERS, "youtube", tmp_path)
    monkeypatch.setattr(scanner, "_probe_duration", lambda path: 42.0)
    monkeypatch.setattr(scanner, "_make_thumb", lambda path, duration: "t.jpg")

    (tmp_path / "a.mp4").write_bytes(b"x")
    (tmp_path / "b.mp4").write_bytes(b"y")

    scanner.scan_folder("youtube")

    from app.models import LibraryItem

    items = db.query(LibraryItem).filter_by(folder="youtube").all()
    assert len(items) == 2
    assert all(item.duration == 42.0 for item in items)
    assert all(item.thumbnail == "t.jpg" for item in items)

    (tmp_path / "a.mp4").unlink()
    scanner.scan_folder("youtube")

    items = db.query(LibraryItem).filter_by(folder="youtube").all()
    assert len(items) == 1
    assert items[0].filename == "b.mp4"
