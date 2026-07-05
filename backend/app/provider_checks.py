"""Lightweight credential/reachability probes for the Settings page and preflight.

Each check takes the value to test as a parameter (never reads settings_store
directly) so routes can validate either the currently-stored value or a value
about to be saved. Every check is defensive: no exception ever escapes, and a
blank credential short-circuits before any network call.
"""
import httpx

from .search.tmdb import TMDB_API
from .torbox.client import TORBOX_API

_TIMEOUT = 5.0


async def check_tmdb(key: str) -> dict:
    key = (key or "").strip()
    if not key:
        return {"ok": False, "detail": "Not configured"}
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(f"{TMDB_API}/configuration", params={"api_key": key})
        if resp.status_code == 200:
            return {"ok": True, "detail": "TMDB key is valid"}
        if resp.status_code in (401, 403):
            return {"ok": False, "detail": "TMDB rejected this key (unauthorized)"}
        return {"ok": False, "detail": f"TMDB returned {resp.status_code}"}
    except Exception as exc:  # noqa: BLE001 - never raise from a health probe
        return {"ok": False, "detail": str(exc) or "TMDB request failed"}


async def check_torbox(key: str) -> dict:
    key = (key or "").strip()
    if not key:
        return {"ok": False, "detail": "Not configured"}
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(
                f"{TORBOX_API}/torrents/mylist",
                headers={"Authorization": f"Bearer {key}"},
                params={"bypass_cache": "true"},
            )
        if resp.status_code == 200:
            return {"ok": True, "detail": "TorBox key is valid"}
        if resp.status_code in (401, 403):
            return {"ok": False, "detail": "TorBox rejected this key (unauthorized)"}
        return {"ok": False, "detail": f"TorBox returned {resp.status_code}"}
    except Exception as exc:  # noqa: BLE001 - never raise from a health probe
        return {"ok": False, "detail": str(exc) or "TorBox request failed"}


async def check_aiostreams(base: str) -> dict:
    base = (base or "").strip().rstrip("/")
    if not base:
        return {"ok": False, "detail": "Not configured"}
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT, follow_redirects=True) as client:
            resp = await client.get(f"{base}/manifest.json")
        if resp.status_code == 200:
            try:
                data = resp.json()
            except ValueError:
                return {"ok": False, "detail": "AIOStreams manifest was not valid JSON"}
            if isinstance(data, dict) and data.get("name"):
                return {"ok": True, "detail": f"Reachable ({data.get('name')})"}
            return {"ok": False, "detail": "AIOStreams manifest is missing a name field"}
        return {"ok": False, "detail": f"AIOStreams returned {resp.status_code}"}
    except Exception as exc:  # noqa: BLE001 - never raise from a health probe
        return {"ok": False, "detail": str(exc) or "AIOStreams request failed"}
