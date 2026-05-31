import httpx

from .. import settings_store
from .parse import parse_streams


def _base() -> str:
    base = (settings_store.get("aiostreams_base", "") or "").strip()
    return base.rstrip("/")


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
