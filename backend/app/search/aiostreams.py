import httpx

from .. import settings_store
from .parse import parse_streams


def _base() -> str:
    base = (settings_store.get("aiostreams_base", "") or "").strip()
    return base.rstrip("/")


def format_request_error(exc: Exception, base: str = "") -> str:
    """Turn httpx failures into actionable messages for the UI."""
    resolved = (base or _base() or "").strip()
    if isinstance(exc, httpx.ConnectError):
        hint = "start-stack.cmd or AIOStreams\\start-aiostreams.cmd"
        if resolved:
            return f"AIOStreams is not running at {resolved} — run {hint}"
        return f"AIOStreams is not reachable — run {hint}"
    return f"AIOStreams request failed: {exc}"


async def check_reachable() -> dict[str, str | bool]:
    """Probe manifest.json — used by preflight and diagnostics."""
    base = _base()
    if not base:
        return {
            "ok": False,
            "base": "",
            "detail": "Not configured — start AIOStreams and check Settings",
        }
    url = f"{base}/manifest.json"
    try:
        async with httpx.AsyncClient(follow_redirects=True) as client:
            resp = await client.get(url, timeout=5)
            resp.raise_for_status()
        return {"ok": True, "base": base, "detail": "Reachable"}
    except httpx.HTTPError as exc:
        return {"ok": False, "base": base, "detail": format_request_error(exc, base)}


async def fetch_streams(type_: str, video_id: str) -> list[dict]:
    base = _base()
    if not base:
        raise RuntimeError("AIOStreams base URL is not configured (Settings page).")
    # Stremio resource convention: /stream/{type}/{id}.json
    url = f"{base}/stream/{type_}/{video_id}.json"
    async with httpx.AsyncClient(follow_redirects=True) as client:
        resp = await client.get(url, timeout=60)
        resp.raise_for_status()
        data = resp.json()
    return parse_streams(data.get("streams", []) or [])


def build_video_id(imdb_id: str, season: int | None, episode: int | None) -> str:
    if season and episode:
        return f"{imdb_id}:{season}:{episode}"
    return imdb_id
