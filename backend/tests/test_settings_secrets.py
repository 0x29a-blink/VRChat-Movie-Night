from app import provider_checks, settings_store
from app.auth import COOKIE_NAME, hash_password, make_token
from app.models import User


def test_settings_get_never_returns_secret_values(client, db):
    settings_store.set_value("tmdb_api_key", "sekrit-123")
    settings_store.set_value("obs_password", "obs-sekrit")
    settings_store.set_value("torbox_api_key", "torbox-sekrit")

    res = client.get("/api/settings")
    assert res.status_code == 200
    data = res.json()

    assert data["tmdb_api_key"] == ""
    assert data["obs_password"] == ""
    assert data["torbox_api_key"] == ""
    assert data["tmdb_api_key_set"] is True
    assert data["obs_password_set"] is True
    assert data["torbox_api_key_set"] is True

    assert "sekrit-123" not in res.text
    assert "obs-sekrit" not in res.text
    assert "torbox-sekrit" not in res.text


def test_settings_put_blank_secret_keeps_stored_value(client, db):
    settings_store.set_value("tmdb_api_key", "sekrit-123")

    payload = dict(client.get("/api/settings").json())
    payload["tmdb_api_key"] = ""
    res = client.put("/api/settings", json=payload)
    assert res.status_code == 200

    assert settings_store.get("tmdb_api_key") == "sekrit-123"


def test_settings_put_new_secret_replaces_value(client, db):
    settings_store.set_value("tmdb_api_key", "sekrit-123")

    payload = dict(client.get("/api/settings").json())
    payload["tmdb_api_key"] = "new-key"
    res = client.put("/api/settings", json=payload)
    assert res.status_code == 200

    assert settings_store.get("tmdb_api_key") == "new-key"
    assert res.json()["tmdb_api_key"] == ""


def test_user_create_and_reset_do_not_echo_password(client, db):
    res = client.post("/api/users", json={"username": "newbie", "password": "hunter22", "role": "member"})
    assert res.status_code == 200
    assert "password" not in res.json()

    user_id = res.json()["user"]["id"]
    res2 = client.post(f"/api/users/{user_id}/reset-password", json={"password": "hunter222"})
    assert res2.status_code == 200
    assert "password" not in res2.json()


def test_test_tmdb_route_uses_stored_key(client, db, monkeypatch):
    settings_store.set_value("tmdb_api_key", "stored-tmdb-key")
    seen: list[str] = []

    async def fake_check(key):
        seen.append(key)
        return {"ok": True, "detail": "TMDB key is valid"}

    monkeypatch.setattr("app.routers.settings_routes.check_tmdb", fake_check)
    res = client.post("/api/settings/test-tmdb")
    assert res.status_code == 200
    assert res.json() == {"ok": True, "detail": "TMDB key is valid"}
    assert seen == ["stored-tmdb-key"]


def test_test_torbox_route_uses_stored_key(client, db, monkeypatch):
    settings_store.set_value("torbox_api_key", "stored-torbox-key")
    seen: list[str] = []

    async def fake_check(key):
        seen.append(key)
        return {"ok": True, "detail": "TorBox key is valid"}

    monkeypatch.setattr("app.routers.settings_routes.check_torbox", fake_check)
    res = client.post("/api/settings/test-torbox")
    assert res.status_code == 200
    assert res.json() == {"ok": True, "detail": "TorBox key is valid"}
    assert seen == ["stored-torbox-key"]


def test_test_aiostreams_route_uses_effective_base(client, db, monkeypatch):
    monkeypatch.setattr(settings_store, "get_aiostreams_effective", lambda: "http://localhost:3000/stremio/abc")
    seen: list[str] = []

    async def fake_check(base):
        seen.append(base)
        return {"ok": True, "detail": "Reachable"}

    monkeypatch.setattr("app.routers.settings_routes.check_aiostreams", fake_check)
    res = client.post("/api/settings/test-aiostreams")
    assert res.status_code == 200
    assert res.json() == {"ok": True, "detail": "Reachable"}
    assert seen == ["http://localhost:3000/stremio/abc"]


def test_provider_test_routes_require_admin(client, db):
    member = User(username="providertester", password_hash=hash_password("test"), role="member")
    db.add(member)
    db.commit()
    db.refresh(member)
    client.cookies.set(COOKIE_NAME, make_token(member))

    assert client.post("/api/settings/test-tmdb").status_code == 403
    assert client.post("/api/settings/test-torbox").status_code == 403
    assert client.post("/api/settings/test-aiostreams").status_code == 403


def test_provider_checks_module_still_exports_real_functions():
    # Sanity: the route module imports the real check functions by name.
    from app.routers import settings_routes

    assert settings_routes.check_tmdb is provider_checks.check_tmdb
    assert settings_routes.check_torbox is provider_checks.check_torbox
    assert settings_routes.check_aiostreams is provider_checks.check_aiostreams
