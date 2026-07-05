import asyncio

from app.downloads.manager import DownloadManager
from app.models import Job


def _make_job(job_id: str, cache_size_bytes: int = 0) -> Job:
    return Job(
        id=job_id,
        type="torrent",
        source="https://example.test/cdn/file",
        restart_source="https://example.test/cdn/file",
        title=job_id,
        status="downloading",
        download_mode="torbox_cache",
        cache_size_bytes=cache_size_bytes,
    )


class _FakeAsyncBytesIter:
    def __init__(self, chunks: list[bytes]):
        self._chunks = chunks

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for chunk in self._chunks:
            yield chunk


class _FakeStreamResponse:
    def __init__(self, headers: dict, chunks: list[bytes]):
        self.status_code = 200
        self.headers = headers
        self.url = "https://example.test/cdn/file"
        self._chunks = chunks

    def aiter_bytes(self, chunk_size: int = 1024 * 256):
        return _FakeAsyncBytesIter(self._chunks)

    async def aread(self):
        return b""


class _FakeStreamCtx:
    def __init__(self, resp: _FakeStreamResponse):
        self._resp = resp

    async def __aenter__(self):
        return self._resp

    async def __aexit__(self, *exc):
        return False


class _FakeAsyncClient:
    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    def stream(self, method, url, headers=None):
        return _FakeStreamCtx(_FakeStreamResponse(_HEADERS, _CHUNKS))


_HEADERS: dict = {}
_CHUNKS: list[bytes] = []


def _install_fake_client(monkeypatch, headers: dict, chunks: list[bytes]):
    from app.downloads import manager as dl_manager

    global _HEADERS, _CHUNKS
    _HEADERS = headers
    _CHUNKS = chunks
    monkeypatch.setattr(dl_manager.httpx, "AsyncClient", _FakeAsyncClient)


def test_direct_http_uses_cache_size_hint_when_no_content_length(db, tmp_path, monkeypatch):
    job = _make_job("job-hint", cache_size_bytes=4096)
    db.add(job)
    db.commit()

    chunks = [b"a" * 1024, b"b" * 1024]
    _install_fake_client(monkeypatch, headers={}, chunks=chunks)

    mgr = DownloadManager()
    rc, final_path, err = asyncio.run(
        mgr._run_direct_http(
            "job-hint", "https://example.test/cdn/file", tmp_path, "", "movie"
        )
    )

    assert rc == 0, err
    assert final_path
    from pathlib import Path

    assert Path(final_path).exists()

    from app.db import SessionLocal

    with SessionLocal() as s:
        row = s.get(Job, "job-hint")
        assert row.downloaded == 2048
        assert row.total == 4096
        assert row.percent > 0


def test_direct_http_no_hint_no_content_length_keeps_percent_zero(db, tmp_path, monkeypatch):
    job = _make_job("job-nohint", cache_size_bytes=0)
    db.add(job)
    db.commit()

    chunks = [b"a" * 1024, b"b" * 1024]
    _install_fake_client(monkeypatch, headers={}, chunks=chunks)

    mgr = DownloadManager()
    rc, final_path, err = asyncio.run(
        mgr._run_direct_http(
            "job-nohint", "https://example.test/cdn/file", tmp_path, "", "movie"
        )
    )

    assert rc == 0, err

    from app.db import SessionLocal

    with SessionLocal() as s:
        row = s.get(Job, "job-nohint")
        assert row.downloaded == 2048
        assert row.total == 0
        assert row.percent == 0
