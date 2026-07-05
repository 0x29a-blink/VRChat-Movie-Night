from app.routers import health_routes


def _reset_cache(monkeypatch):
    monkeypatch.setattr(health_routes, "_provider_cache", None)
    monkeypatch.setattr(health_routes, "_preflight_cache", None)


def _install_counting_checks(monkeypatch):
    calls = {"tmdb": 0, "torbox": 0, "aiostreams": 0}

    async def fake_tmdb(_key):
        calls["tmdb"] += 1
        return {"ok": True, "detail": "TMDB key is valid"}

    async def fake_torbox(_key):
        calls["torbox"] += 1
        return {"ok": False, "detail": "TorBox rejected this key (unauthorized)"}

    async def fake_aiostreams(_base):
        calls["aiostreams"] += 1
        return {"ok": True, "detail": "Reachable (AIOStreams)"}

    monkeypatch.setattr(health_routes, "check_tmdb", fake_tmdb)
    monkeypatch.setattr(health_routes, "check_torbox", fake_torbox)
    monkeypatch.setattr(health_routes, "check_aiostreams", fake_aiostreams)
    return calls


def test_preflight_includes_provider_items(client, db, monkeypatch):
    _reset_cache(monkeypatch)
    _install_counting_checks(monkeypatch)

    res = client.get("/api/health/preflight")
    assert res.status_code == 200
    data = res.json()
    assert "providers" in data
    names = {item["name"] for item in data["providers"]}
    assert "TMDB" in names
    assert "TorBox" in names
    assert any("AIOStreams" in name for name in names)

    tmdb_item = next(item for item in data["providers"] if item["name"] == "TMDB")
    assert tmdb_item["ok"] is True
    torbox_item = next(item for item in data["providers"] if item["name"] == "TorBox")
    assert torbox_item["ok"] is False
    assert "detail" in torbox_item


def test_preflight_provider_checks_are_cached_within_window(client, db, monkeypatch):
    _reset_cache(monkeypatch)
    calls = _install_counting_checks(monkeypatch)

    res1 = client.get("/api/health/preflight")
    res2 = client.get("/api/health/preflight")
    assert res1.status_code == 200
    assert res2.status_code == 200

    assert calls["tmdb"] == 1
    assert calls["torbox"] == 1
    assert calls["aiostreams"] == 1


def test_preflight_provider_check_failure_does_not_break_preflight(client, db, monkeypatch):
    _reset_cache(monkeypatch)

    async def boom(*_args):
        raise RuntimeError("simulated provider check crash")

    monkeypatch.setattr(health_routes, "check_tmdb", boom)
    monkeypatch.setattr(health_routes, "check_torbox", boom)
    monkeypatch.setattr(health_routes, "check_aiostreams", boom)

    res = client.get("/api/health/preflight")
    assert res.status_code == 200
    data = res.json()
    assert "providers" in data
    assert all(item["ok"] is False for item in data["providers"])


def test_preflight_provider_items_do_not_affect_checklist_ok(client, db, monkeypatch):
    _reset_cache(monkeypatch)

    async def all_bad_tmdb(_key):
        return {"ok": False, "detail": "Not configured"}

    async def all_bad_torbox(_key):
        return {"ok": False, "detail": "Not configured"}

    monkeypatch.setattr(health_routes, "check_tmdb", all_bad_tmdb)
    monkeypatch.setattr(health_routes, "check_torbox", all_bad_torbox)
    # aiostreams check_reachable() (separate from provider_checks.check_aiostreams)
    # already drives aiostreams_ok/issues — provider items must not duplicate that.

    res = client.get("/api/health/preflight")
    assert res.status_code == 200
    data = res.json()
    issues_text = " ".join(data["issues"])
    assert "TMDB" not in issues_text
    assert "TorBox" not in issues_text
