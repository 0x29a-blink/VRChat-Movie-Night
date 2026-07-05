import asyncio

from app.downloads.manager import DownloadManager
from app.models import Job


def _make_job(job_id: str, status: str) -> Job:
    return Job(
        id=job_id,
        type="youtube",
        source=f"https://example.test/{job_id}",
        restart_source=f"https://example.test/{job_id}",
        title=job_id,
        status=status,
    )


def test_recover_interrupted_jobs_marks_stale_statuses_failed(db):
    downloading = _make_job("job-downloading", "downloading")
    queued = _make_job("job-queued", "queued")
    caching = _make_job("job-caching", "caching")
    completed = _make_job("job-completed", "completed")
    db.add_all([downloading, queued, caching, completed])
    db.commit()

    mgr = DownloadManager()
    mgr.recover_interrupted_jobs()

    db.refresh(downloading)
    db.refresh(queued)
    db.refresh(caching)
    db.refresh(completed)

    assert downloading.status == "failed"
    assert downloading.error == "Interrupted by server restart"
    assert queued.status == "failed"
    assert queued.error == "Interrupted by server restart"
    assert caching.status == "failed"
    assert caching.error == "Interrupted by server restart"

    assert completed.status == "completed"
    assert completed.error == ""


def test_cancel_queued_job_marks_cancelled(db, monkeypatch):
    from app.downloads import manager as dl_manager

    async def fake_broadcast(event, data):
        pass

    monkeypatch.setattr(dl_manager.hub, "broadcast", fake_broadcast)

    job = _make_job("job-to-cancel", "queued")
    db.add(job)
    db.commit()

    mgr = DownloadManager()
    result = asyncio.run(mgr.cancel("job-to-cancel"))

    db.refresh(job)
    assert result is True
    assert job.status == "cancelled"


def test_cancel_unknown_job_id_returns_true_without_raising(db, monkeypatch):
    from app.downloads import manager as dl_manager

    async def fake_broadcast(event, data):
        pass

    monkeypatch.setattr(dl_manager.hub, "broadcast", fake_broadcast)

    mgr = DownloadManager()
    # BUG?: cancel() returns True unconditionally for an id that doesn't exist
    # in the DB (manager.py:314-327) -- current behavior asserted here, not a fix.
    result = asyncio.run(mgr.cancel("does-not-exist"))

    assert result is True
