import asyncio
import time

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from .. import auth, settings_store
from ..config import settings
from ..db import get_db
from ..models import User
from ..network_utils import build_hls_url, check_mediamtx_stream
from ..obs.controller import aio, controller
from ..provider_checks import check_aiostreams, check_tmdb, check_torbox
from ..search import aiostreams
from ..tool_checks import check_all_tools

router = APIRouter(prefix="/api/health", tags=["health"])

# Provider credential checks hit real services — cache briefly so the panel's
# 15s poll doesn't hammer TMDB/TorBox/AIOStreams. Informational only: never
# added to `issues`/`checklist_ok` (a bad key shouldn't block movie night).
_PROVIDER_CACHE_SECONDS = 60.0
_provider_cache: tuple[float, list[dict]] | None = None

# The full preflight sweep (OBS, MediaMTX, tool checks, AIOStreams reachability,
# provider checks) is expensive and was previously run on every single call —
# with several overlapping frontend pollers this caused a request stampede
# that tripped AIOStreams' own rate limiter. Cache the request-independent
# "core" for a short TTL and single-flight concurrent callers behind a lock so
# any number of clients collapses to at most one real sweep per TTL window.
_PREFLIGHT_TTL = 15.0
_preflight_cache: tuple[float, dict] | None = None
_preflight_lock = asyncio.Lock()


def _reset_preflight_cache() -> None:
    """Test helper: clear both the preflight core cache and the provider cache."""
    global _preflight_cache, _provider_cache
    _preflight_cache = None
    _provider_cache = None


async def _get_provider_items() -> list[dict]:
    global _provider_cache
    now = time.monotonic()
    if _provider_cache is not None:
        cached_at, items = _provider_cache
        if now - cached_at < _PROVIDER_CACHE_SECONDS:
            return items

    try:
        tmdb_result, torbox_result, aiostreams_result = await asyncio.gather(
            check_tmdb(settings_store.get("tmdb_api_key", "")),
            check_torbox(settings_store.get("torbox_api_key", "")),
            check_aiostreams(settings_store.get_aiostreams_effective()),
        )
        items = [
            {"name": "TMDB", "ok": bool(tmdb_result.get("ok")), "detail": str(tmdb_result.get("detail") or "")},
            {"name": "TorBox", "ok": bool(torbox_result.get("ok")), "detail": str(torbox_result.get("detail") or "")},
            {
                "name": "AIOStreams key/manifest",
                "ok": bool(aiostreams_result.get("ok")),
                "detail": str(aiostreams_result.get("detail") or ""),
            },
        ]
    except Exception as exc:  # noqa: BLE001 - provider checks must never break preflight
        items = [
            {"name": "TMDB", "ok": False, "detail": str(exc)},
            {"name": "TorBox", "ok": False, "detail": str(exc)},
            {"name": "AIOStreams key/manifest", "ok": False, "detail": str(exc)},
        ]

    _provider_cache = (now, items)
    return items


def _build_issues(
    *,
    obs_connected: bool,
    obs_streaming: bool,
    mediamtx_running: bool,
    hls_stream_active: bool,
    aiostreams_ok: bool,
    aiostreams_detail: str,
    user_count: int,
    tools: list[dict],
) -> list[str]:
    issues: list[str] = []
    if settings.secret_key == "please-change-this-to-a-long-random-string":
        issues.append("SECRET_KEY is still the default; change it before LAN or internet use")
    if settings.app_password == "changeme":
        issues.append("APP_PASSWORD is still the default bootstrap password")
    if str(settings_store.get("obs_password", settings.obs_password) or "") == "changeme":
        issues.append("OBS WebSocket password is still the default")
    if not obs_connected:
        issues.append("OBS WebSocket is not connected")
    if not mediamtx_running:
        issues.append("MediaMTX is not running (port 8888)")
    if not aiostreams_ok:
        issues.append(aiostreams_detail or "AIOStreams is not reachable (port 3000)")
    if user_count <= 0:
        issues.append("No user accounts configured")
    for tool in tools:
        if not tool.get("ok"):
            issues.append(f"{tool.get('name', 'Tool')} unavailable: {tool.get('detail', 'missing')}")
    if obs_streaming and not hls_stream_active:
        issues.append("OBS is streaming but the HLS feed is not active")
    return issues


async def _preflight_core(db: Session) -> dict:
    """Everything preflight needs except the request-derived `hls_url`."""
    obs = await aio(controller.connection_info)
    obs_connected = bool(obs.get("connected"))
    obs_streaming = bool(obs.get("streaming"))

    mediamtx_running, hls_stream_active, hls_error, hls_rel_path = await check_mediamtx_stream(
        obs_streaming=obs_streaming
    )

    user_count = db.query(User).count()
    tools = await check_all_tools()
    aiostreams_status = await aiostreams.check_reachable()
    providers = await _get_provider_items()
    issues = _build_issues(
        obs_connected=obs_connected,
        obs_streaming=obs_streaming,
        mediamtx_running=mediamtx_running,
        hls_stream_active=hls_stream_active,
        aiostreams_ok=bool(aiostreams_status.get("ok")),
        aiostreams_detail=str(aiostreams_status.get("detail") or ""),
        user_count=user_count,
        tools=tools,
    )

    return {
        "api": True,
        "obs_connected": obs_connected,
        "obs_streaming": obs_streaming,
        "mediamtx_running": mediamtx_running,
        "hls_stream_active": hls_stream_active,
        "hls_reachable": hls_stream_active,
        "hls_error": hls_error,
        "hls_path": hls_rel_path,
        "aiostreams_ok": bool(aiostreams_status.get("ok")),
        "aiostreams_base": str(aiostreams_status.get("base") or ""),
        "aiostreams_detail": str(aiostreams_status.get("detail") or ""),
        "users": user_count,
        "tools": tools,
        "providers": providers,
        "issues": issues,
        "checklist_ok": len(issues) == 0,
        "ready": obs_connected and mediamtx_running and hls_stream_active and user_count > 0,
    }


async def _get_preflight_core(db: Session) -> dict:
    """Single-flight, TTL-cached wrapper around `_preflight_core`.

    Any number of concurrent/rapid callers collapse to at most one real sweep
    per `_PREFLIGHT_TTL` window. Returns a shallow copy so callers can freely
    add request-derived keys (e.g. `hls_url`) without mutating the cache.
    """
    global _preflight_cache
    now = time.monotonic()
    if _preflight_cache is not None:
        cached_at, core = _preflight_cache
        if now - cached_at < _PREFLIGHT_TTL:
            out = dict(core)
            out["checked_at_age_sec"] = round(now - cached_at, 1)
            return out

    async with _preflight_lock:
        # Double-checked locking: a waiter that queued behind the sweep must
        # use the fresh result the sweep just produced, not run its own.
        now = time.monotonic()
        if _preflight_cache is not None:
            cached_at, core = _preflight_cache
            if now - cached_at < _PREFLIGHT_TTL:
                out = dict(core)
                out["checked_at_age_sec"] = round(now - cached_at, 1)
                return out

        core = await _preflight_core(db)
        cached_at = time.monotonic()
        _preflight_cache = (cached_at, core)
        out = dict(core)
        out["checked_at_age_sec"] = 0.0
        return out


@router.get("/preflight")
async def preflight(
    request: Request,
    db: Session = Depends(get_db),
    _: auth.CurrentUser = Depends(auth.require_auth),
):
    core = await _get_preflight_core(db)
    out = dict(core)
    out["hls_url"] = build_hls_url(request, core["hls_path"])
    return out


@router.get("/hls-url")
async def hls_url(request: Request, _: auth.CurrentUser = Depends(auth.require_auth)):
    obs = await aio(controller.connection_info)
    _, active, _, rel_path = await check_mediamtx_stream(obs_streaming=bool(obs.get("streaming")))
    return {"url": build_hls_url(request, rel_path), "active": active, "path": rel_path}
