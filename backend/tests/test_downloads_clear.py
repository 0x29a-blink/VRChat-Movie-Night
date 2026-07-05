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


def test_clear_completed_leaves_active_untouched(client, db, monkeypatch):
    from app.downloads import manager as dl_manager

    async def fake_broadcast(event, data):
        pass

    monkeypatch.setattr(dl_manager.hub, "broadcast", fake_broadcast)

    completed = _make_job("job-completed", "completed")
    failed = _make_job("job-failed", "failed")
    downloading = _make_job("job-downloading", "downloading")
    db.add_all([completed, failed, downloading])
    db.commit()

    res = client.post("/api/downloads/clear", json={"statuses": ["completed"]})
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert body["removed"] == ["job-completed"]

    remaining_ids = {j.id for j in db.query(Job).all()}
    assert remaining_ids == {"job-failed", "job-downloading"}


def test_clear_completed_and_failed(client, db, monkeypatch):
    from app.downloads import manager as dl_manager

    async def fake_broadcast(event, data):
        pass

    monkeypatch.setattr(dl_manager.hub, "broadcast", fake_broadcast)

    completed = _make_job("job-completed", "completed")
    failed = _make_job("job-failed", "failed")
    downloading = _make_job("job-downloading", "downloading")
    db.add_all([completed, failed, downloading])
    db.commit()

    res = client.post(
        "/api/downloads/clear", json={"statuses": ["completed", "failed"]}
    )
    assert res.status_code == 200
    removed = set(res.json()["removed"])
    assert removed == {"job-completed", "job-failed"}

    remaining_ids = {j.id for j in db.query(Job).all()}
    assert remaining_ids == {"job-downloading"}


def test_clear_rejects_non_terminal_statuses(client, db):
    res = client.post("/api/downloads/clear", json={"statuses": ["downloading"]})
    assert res.status_code == 400
    assert "statuses" in res.json()["detail"]


def test_clear_rejects_empty_statuses(client, db):
    res = client.post("/api/downloads/clear", json={"statuses": []})
    assert res.status_code == 400
