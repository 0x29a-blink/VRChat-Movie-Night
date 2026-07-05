import asyncio

from app.downloads.manager import DownloadManager
from app.models import Job


def _make_failed_job(job_id: str) -> Job:
    return Job(
        id=job_id,
        type="torrent",
        source="https://example.test/video.mkv",
        restart_source="https://example.test/video.mkv",
        download_mode="normal",
        title=job_id,
        status="failed",
        error="boom",
    )


def test_restart_with_direct_mode_routes_to_direct_http(db, monkeypatch):
    from app.downloads import manager as dl_manager

    async def fake_broadcast(event, data):
        pass

    monkeypatch.setattr(dl_manager.hub, "broadcast", fake_broadcast)

    calls = []

    async def fake_run_direct_http(self, job_id, source, out_dir, referer, provided, filename_hint=""):
        calls.append(job_id)
        return 0, str(out_dir / "video.mkv"), ""

    async def fake_probe(*args, **kwargs):
        raise AssertionError("probe should not be called when force_kind is set")

    monkeypatch.setattr(DownloadManager, "_run_direct_http", fake_run_direct_http)
    monkeypatch.setattr(dl_manager, "_probe_download_kind", fake_probe)

    def fake_scan_folder(type_):
        pass

    monkeypatch.setattr("app.library.scanner.scan_folder", fake_scan_folder)

    job = _make_failed_job("job-retry")
    db.add(job)
    db.commit()

    mgr = DownloadManager()
    mgr.set_concurrency_limit(1)

    result = asyncio.run(mgr.restart("job-retry", retry_mode="direct"))
    assert result is not None
    new_job_id = result["id"]
    assert new_job_id != "job-retry"

    # The task is scheduled via asyncio.create_task inside restart()->add();
    # run the event loop briefly so it executes.
    async def _drain():
        task = mgr._tasks.get(new_job_id)
        if task:
            await task

    asyncio.run(_drain())

    assert calls == [new_job_id]


def test_restart_torbox_mode_ignores_override(db, monkeypatch):
    from app.downloads import manager as dl_manager

    async def fake_broadcast(event, data):
        pass

    monkeypatch.setattr(dl_manager.hub, "broadcast", fake_broadcast)

    job = Job(
        id="job-torbox",
        type="torrent",
        source="magnet:?xt=urn:btih:abc",
        restart_source="magnet:?xt=urn:btih:abc",
        download_mode="torbox_cache",
        title="job-torbox",
        status="failed",
        cache_size_bytes=1000,
    )
    db.add(job)
    db.commit()

    calls = {}

    async def fake_add_torbox_cache(self, magnet, **kwargs):
        calls["called"] = True
        calls["kwargs"] = kwargs
        return {"id": "new-torbox-job"}

    monkeypatch.setattr(DownloadManager, "add_torbox_cache", fake_add_torbox_cache)

    mgr = DownloadManager()
    result = asyncio.run(mgr.restart("job-torbox", retry_mode="direct"))

    assert result == {"id": "new-torbox-job"}
    assert calls.get("called") is True
