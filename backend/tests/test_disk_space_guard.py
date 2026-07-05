from collections import namedtuple

_Usage = namedtuple("Usage", ["total", "used", "free"])


def test_add_torrent_400s_when_disk_nearly_full(client, monkeypatch):
    from app.routers import downloads_routes

    monkeypatch.setattr(
        downloads_routes.shutil,
        "disk_usage",
        lambda path: _Usage(total=10**12, used=10**12 - 1024, free=1024),
    )

    res = client.post(
        "/api/downloads/torrent",
        json={
            "magnet": "magnet:?xt=urn:btih:deadbeef",
            "cache_first": True,
            "title": "Big Movie",
            "size_bytes": 5 * 1024**3,
        },
    )
    assert res.status_code == 400
    assert "disk" in res.json()["detail"].lower()


def test_add_torrent_200s_with_generous_space(client, monkeypatch):
    from app.routers import downloads_routes

    monkeypatch.setattr(
        downloads_routes.shutil,
        "disk_usage",
        lambda path: _Usage(total=10**13, used=1024, free=10**13 - 1024),
    )

    async def fake_add_torbox_cache(magnet, **kwargs):
        return {"id": "job-1", "status": "caching"}

    monkeypatch.setattr(
        downloads_routes.manager, "add_torbox_cache", fake_add_torbox_cache
    )

    res = client.post(
        "/api/downloads/torrent",
        json={
            "magnet": "magnet:?xt=urn:btih:deadbeef",
            "cache_first": True,
            "title": "Big Movie",
            "size_bytes": 5 * 1024**3,
        },
    )
    assert res.status_code == 200
    assert res.json()["id"] == "job-1"


def test_add_torrent_no_size_hint_skips_check(client, monkeypatch):
    from app.routers import downloads_routes

    def boom(path):
        raise AssertionError("disk_usage should not be called with no size hint")

    monkeypatch.setattr(downloads_routes.shutil, "disk_usage", boom)

    async def fake_add(type_, source, **kwargs):
        return {"id": "job-2", "status": "queued"}

    monkeypatch.setattr(downloads_routes.manager, "add", fake_add)

    res = client.post(
        "/api/downloads/torrent",
        json={"url": "https://example.test/movie.torrent", "title": "No Hint"},
    )
    assert res.status_code == 200
    assert res.json()["id"] == "job-2"
