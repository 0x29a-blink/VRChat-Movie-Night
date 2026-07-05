import asyncio

import pytest

from app.routers import health_routes


@pytest.fixture(autouse=True)
def _reset_cache():
    health_routes._reset_preflight_cache()
    yield
    health_routes._reset_preflight_cache()


def _install_counting_fakes(monkeypatch, *, sleep: float = 0.0):
    calls = {"tools": 0, "aiostreams": 0}

    async def fake_check_all_tools():
        calls["tools"] += 1
        if sleep:
            await asyncio.sleep(sleep)
        return []

    async def fake_check_reachable():
        calls["aiostreams"] += 1
        if sleep:
            await asyncio.sleep(sleep)
        return {"ok": True, "base": "http://localhost:3000", "detail": "Reachable"}

    monkeypatch.setattr(health_routes, "check_all_tools", fake_check_all_tools)
    monkeypatch.setattr(health_routes.aiostreams, "check_reachable", fake_check_reachable)
    return calls


def test_preflight_second_call_within_ttl_skips_checks(client, monkeypatch):
    calls = _install_counting_fakes(monkeypatch)

    res1 = client.get("/api/health/preflight")
    res2 = client.get("/api/health/preflight")

    assert res1.status_code == 200
    assert res2.status_code == 200
    assert calls["tools"] == 1
    assert calls["aiostreams"] == 1
    assert res1.json()["checked_at_age_sec"] == 0.0
    assert res2.json()["checked_at_age_sec"] >= 0.0


def test_preflight_concurrent_calls_single_flight(db, monkeypatch):
    calls = _install_counting_fakes(monkeypatch, sleep=0.1)

    async def run():
        return await asyncio.gather(*[health_routes._get_preflight_core(db) for _ in range(5)])

    results = asyncio.run(run())

    assert calls["tools"] == 1
    assert calls["aiostreams"] == 1
    assert len(results) == 5
    first = results[0]
    for result in results[1:]:
        assert result == first


def test_preflight_cache_expires(client, monkeypatch):
    calls = _install_counting_fakes(monkeypatch)

    real_monotonic = health_routes.time.monotonic
    offset = {"value": 0.0}

    def fake_monotonic():
        return real_monotonic() + offset["value"]

    monkeypatch.setattr(health_routes.time, "monotonic", fake_monotonic)

    res1 = client.get("/api/health/preflight")
    assert res1.status_code == 200
    assert calls["tools"] == 1
    assert calls["aiostreams"] == 1

    offset["value"] = health_routes._PREFLIGHT_TTL + 1.0

    res2 = client.get("/api/health/preflight")
    assert res2.status_code == 200
    assert calls["tools"] == 2
    assert calls["aiostreams"] == 2
    assert res2.json()["checked_at_age_sec"] == 0.0
