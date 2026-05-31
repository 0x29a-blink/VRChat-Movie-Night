import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request

from .. import auth
from ..search import anime_meta, browse_open, catalog, tmdb
from ..search.anime_meta import pick_anime_catalog_key

router = APIRouter(prefix="/api/browse", tags=["browse"],
                   dependencies=[Depends(auth.require_auth)])


@router.get("/catalogs")
async def list_catalogs():
    try:
        catalogs = await catalog.fetch_manifest_catalogs()
        return {
            "catalogs": catalogs,
            "source": "aiostreams",
            "anime_catalog_key": pick_anime_catalog_key(catalogs),
        }
    except RuntimeError as exc:
        raise HTTPException(400, str(exc))
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"AIOStreams request failed: {exc}")


@router.get("/items")
async def catalog_items(
    request: Request,
    type: str = Query(...),
    id: str = Query(...),
    skip: int = Query(0, ge=0),
    search: str = Query(""),
):
    reserved = frozenset({"type", "id", "skip", "search"})
    extras = {
        k: v
        for k, v in request.query_params.items()
        if k not in reserved and str(v).strip() != ""
    }
    try:
        items, has_more = await catalog.fetch_catalog_items(
            type, id, skip=skip, search=search, extras=extras or None
        )
        return {"items": items, "has_more": has_more, "extras_applied": extras}
    except RuntimeError as exc:
        raise HTTPException(400, str(exc))
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"AIOStreams request failed: {exc}")


@router.get("/open")
async def open_browse_item(
    stremio_id: str = Query(...),
    type: str = Query("movie"),
):
    try:
        return await browse_open.open_item(stremio_id, type)
    except RuntimeError as exc:
        raise HTTPException(400, str(exc))
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"Browse request failed: {exc}") from exc
    except ValueError as exc:
        raise HTTPException(502, f"Browse request failed: {exc}") from exc


@router.get("/resolve")
async def resolve_item(
    stremio_id: str = Query(...),
    type: str = Query("movie"),
):
    """Legacy: returns a flat SearchResult (titles only)."""
    try:
        result = await browse_open.open_item(stremio_id, type)
        if result.get("action") == "collection":
            raise HTTPException(
                400,
                "This is a collection — open it in Browse to see its movies.",
            )
        return result["title"]
    except HTTPException:
        raise
    except RuntimeError as exc:
        raise HTTPException(400, str(exc))
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"TMDB request failed: {exc}")


@router.get("/anime/meta")
async def anime_meta_details(stremio_id: str = Query(..., min_length=3)):
    try:
        meta = await anime_meta.fetch_stremio_meta(stremio_id.strip())
        if not meta:
            raise HTTPException(404, "No AIOStreams meta found for this anime id")
        return {
            "title": anime_meta.meta_to_search_result(meta, stremio_id),
            "seasons": anime_meta.seasons_from_meta(meta),
        }
    except RuntimeError as exc:
        raise HTTPException(400, str(exc)) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"AIOStreams request failed: {exc}") from exc


@router.get("/anime/season/{season}/episodes")
async def anime_season_episodes(stremio_id: str = Query(..., min_length=3), season: int = 0):
    try:
        meta = await anime_meta.fetch_stremio_meta(stremio_id.strip())
        if not meta:
            raise HTTPException(404, "No AIOStreams meta found for this anime id")
        return {"episodes": anime_meta.episodes_for_season(meta, max(1, season))}
    except RuntimeError as exc:
        raise HTTPException(400, str(exc)) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"AIOStreams request failed: {exc}") from exc


@router.get("/collections")
async def search_collections(q: str = Query(..., min_length=1)):
    try:
        return {"collections": await tmdb.search_collections(q)}
    except RuntimeError as exc:
        raise HTTPException(400, str(exc))
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"TMDB request failed: {exc}")


@router.get("/collections/{collection_id}")
async def collection_detail(collection_id: int):
    try:
        return await tmdb.collection_movies(collection_id)
    except RuntimeError as exc:
        raise HTTPException(400, str(exc))
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"TMDB request failed: {exc}")
