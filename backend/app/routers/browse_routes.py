import httpx
from fastapi import APIRouter, Depends, HTTPException, Query

from .. import auth
from ..search import browse_open, catalog, tmdb

router = APIRouter(prefix="/api/browse", tags=["browse"],
                   dependencies=[Depends(auth.require_auth)])


@router.get("/catalogs")
async def list_catalogs():
    try:
        catalogs = await catalog.fetch_manifest_catalogs()
        return {"catalogs": catalogs, "source": "aiostreams"}
    except RuntimeError as exc:
        raise HTTPException(400, str(exc))
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"AIOStreams request failed: {exc}")


@router.get("/items")
async def catalog_items(
    type: str = Query(...),
    id: str = Query(...),
    skip: int = Query(0, ge=0),
    search: str = Query(""),
):
    try:
        items, has_more = await catalog.fetch_catalog_items(
            type, id, skip=skip, search=search
        )
        return {"items": items, "has_more": has_more}
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
        raise HTTPException(502, f"Browse request failed: {exc}")


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
