from urllib.parse import quote

import httpx

from .. import settings_store
from .ids import classify_id
from .numbers import safe_float

_ERROR_PREFIX = "aiostreamserror."


def _base() -> str:
    base = (settings_store.get("aiostreams_base", "") or "").strip()
    return base.rstrip("/")


async def _get_json(path: str) -> dict:
    base = _base()
    if not base:
        raise RuntimeError("AIOStreams base URL is not configured (Settings page).")
    url = f"{base}{path}"
    async with httpx.AsyncClient(follow_redirects=True) as client:
        resp = await client.get(url, timeout=60)
        resp.raise_for_status()
        return resp.json()


def _catalog_path(type_: str, catalog_id: str, extras: dict[str, str] | None = None) -> str:
    if extras:
        parts = [f"{k}={quote(str(v), safe='')}" for k, v in sorted(extras.items()) if v != ""]
        if parts:
            return f"/catalog/{type_}/{catalog_id}/{'&'.join(parts)}.json"
    return f"/catalog/{type_}/{catalog_id}.json"


def _normalize_catalog_entry(entry: dict) -> dict:
    extras = entry.get("extra") or []
    return {
        "type": entry.get("type") or "movie",
        "id": entry.get("id") or "",
        "name": entry.get("name") or entry.get("id") or "Catalog",
        "extras": [
            {
                "name": e.get("name"),
                "required": bool(e.get("isRequired")),
                "options": e.get("options") or [],
            }
            for e in extras
            if e.get("name")
        ],
    }


def _meta_to_item(meta: dict) -> dict | None:
    stremio_id = (meta.get("id") or "").strip()
    if not stremio_id or stremio_id.startswith(_ERROR_PREFIX):
        return None
    media_type = meta.get("type") or "movie"
    if media_type == "tv":
        media_type = "series"
    if media_type not in ("movie", "series", "anime"):
        media_type = "movie"
    raw_rating = meta.get("imdbRating")
    rating = 0.0
    if raw_rating is not None and str(raw_rating).strip().lower() not in ("", "nan", "n/a", "none"):
        rating = safe_float(str(raw_rating).split("/")[0].strip(), 0.0)
    return {
        "stremio_id": stremio_id,
        "kind": classify_id(stremio_id),
        "type": media_type,
        "title": meta.get("name") or "",
        "year": (meta.get("releaseInfo") or "")[:4],
        "overview": meta.get("description") or "",
        "poster": meta.get("poster") or "",
        "rating": rating,
    }


async def fetch_manifest_catalogs() -> list[dict]:
    data = await _get_json("/manifest.json")
    catalogs = [_normalize_catalog_entry(c) for c in data.get("catalogs") or []]
    return [c for c in catalogs if c.get("id")]


async def fetch_catalog_items(
    type_: str,
    catalog_id: str,
    *,
    skip: int = 0,
    search: str = "",
    extras: dict[str, str] | None = None,
) -> tuple[list[dict], bool]:
    params: dict[str, str] = {}
    if skip > 0:
        params["skip"] = str(skip)
    if search.strip():
        params["search"] = search.strip()
    if extras:
        params.update({k: str(v) for k, v in extras.items() if v != ""})
    data = await _get_json(_catalog_path(type_, catalog_id, params or None))
    metas = data.get("metas") or []
    items = [p for m in metas if (p := _meta_to_item(m))]
    # Stremio pages are typically up to 100 items; fewer means likely last page.
    has_more = len(metas) >= 100
    return items, has_more
