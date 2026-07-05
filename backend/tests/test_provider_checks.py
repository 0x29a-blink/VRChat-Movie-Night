import asyncio

import httpx

from app import provider_checks


def _install_mock_transport(monkeypatch, handler):
    """Patch httpx.AsyncClient so every request in the module goes through handler."""
    calls: list[httpx.Request] = []

    def record_and_handle(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return handler(request)

    transport = httpx.MockTransport(record_and_handle)
    real_async_client = httpx.AsyncClient

    def patched_client(*args, **kwargs):
        kwargs["transport"] = transport
        return real_async_client(*args, **kwargs)

    monkeypatch.setattr(provider_checks.httpx, "AsyncClient", patched_client)
    return calls


def test_check_tmdb_valid(monkeypatch):
    calls = _install_mock_transport(
        monkeypatch, lambda req: httpx.Response(200, json={"images": {}})
    )
    result = asyncio.run(provider_checks.check_tmdb("good-key"))
    assert result["ok"] is True
    assert len(calls) == 1


def test_check_tmdb_unauthorized(monkeypatch):
    _install_mock_transport(monkeypatch, lambda req: httpx.Response(401, json={"status_message": "Invalid"}))
    result = asyncio.run(provider_checks.check_tmdb("bad-key"))
    assert result["ok"] is False
    assert "detail" in result


def test_check_tmdb_timeout(monkeypatch):
    def handler(req):
        raise httpx.TimeoutException("timed out", request=req)

    _install_mock_transport(monkeypatch, handler)
    result = asyncio.run(provider_checks.check_tmdb("some-key"))
    assert result["ok"] is False


def test_check_tmdb_empty_key_no_network(monkeypatch):
    calls = _install_mock_transport(monkeypatch, lambda req: httpx.Response(200))
    result = asyncio.run(provider_checks.check_tmdb(""))
    assert result == {"ok": False, "detail": "Not configured"}
    assert calls == []


def test_check_torbox_valid(monkeypatch):
    calls = _install_mock_transport(monkeypatch, lambda req: httpx.Response(200, json={"success": True, "data": []}))
    result = asyncio.run(provider_checks.check_torbox("good-key"))
    assert result["ok"] is True
    assert len(calls) == 1


def test_check_torbox_unauthorized(monkeypatch):
    _install_mock_transport(monkeypatch, lambda req: httpx.Response(401, json={"error": "BAD_TOKEN"}))
    result = asyncio.run(provider_checks.check_torbox("bad-key"))
    assert result["ok"] is False


def test_check_torbox_timeout(monkeypatch):
    def handler(req):
        raise httpx.TimeoutException("timed out", request=req)

    _install_mock_transport(monkeypatch, handler)
    result = asyncio.run(provider_checks.check_torbox("some-key"))
    assert result["ok"] is False


def test_check_torbox_empty_key_no_network(monkeypatch):
    calls = _install_mock_transport(monkeypatch, lambda req: httpx.Response(200))
    result = asyncio.run(provider_checks.check_torbox(""))
    assert result == {"ok": False, "detail": "Not configured"}
    assert calls == []


def test_check_aiostreams_valid(monkeypatch):
    calls = _install_mock_transport(monkeypatch, lambda req: httpx.Response(200, json={"name": "AIOStreams"}))
    result = asyncio.run(provider_checks.check_aiostreams("http://localhost:3000/stremio/abc"))
    assert result["ok"] is True
    assert len(calls) == 1


def test_check_aiostreams_bad_status(monkeypatch):
    _install_mock_transport(monkeypatch, lambda req: httpx.Response(500))
    result = asyncio.run(provider_checks.check_aiostreams("http://localhost:3000/stremio/abc"))
    assert result["ok"] is False


def test_check_aiostreams_timeout(monkeypatch):
    def handler(req):
        raise httpx.ConnectTimeout("timed out", request=req)

    _install_mock_transport(monkeypatch, handler)
    result = asyncio.run(provider_checks.check_aiostreams("http://localhost:3000/stremio/abc"))
    assert result["ok"] is False


def test_check_aiostreams_empty_base_no_network(monkeypatch):
    calls = _install_mock_transport(monkeypatch, lambda req: httpx.Response(200))
    result = asyncio.run(provider_checks.check_aiostreams(""))
    assert result == {"ok": False, "detail": "Not configured"}
    assert calls == []
