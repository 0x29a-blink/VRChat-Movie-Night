import httpx
from fastapi import APIRouter, Depends, HTTPException, Query

from .. import auth
from ..search import aiostreams, tmdb

router = APIRouter(prefix="/api", tags=["search"],
                   dependencies=[Depends(auth.require_auth)])


@router.get("/search")
async def search(q: str = Query(..., min_length=1)):
    try:
        return await tmdb.search(q)
    except RuntimeError as exc:
        raise HTTPException(400, str(exc))
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"TMDB request failed: {exc}")


@router.get("/title/{tmdb_id}")
async def title_details(tmdb_id: int, type: str = Query("movie")):
    try:
        return await tmdb.details(tmdb_id, type)
    except RuntimeError as exc:
        raise HTTPException(400, str(exc))
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"TMDB request failed: {exc}")


@router.get("/title/{tmdb_id}/season/{season}/episodes")
async def season_episodes(tmdb_id: int, season: int):
    try:
        return {"episodes": await tmdb.season_episodes(tmdb_id, season)}
    except RuntimeError as exc:
        raise HTTPException(400, str(exc))
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"TMDB request failed: {exc}")


@router.get("/streams")
async def streams(
    tmdb_id: int = Query(...),
    type: str = Query("movie"),
    season: int | None = Query(None),
    episode: int | None = Query(None),
):
    try:
        ext = await tmdb.external_ids(tmdb_id, type)
        imdb_id = ext.get("imdb_id")
        if not imdb_id:
            raise HTTPException(404, "No IMDB id found for this title")
        video_id = aiostreams.build_video_id(imdb_id, season, episode)
        stream_type = "series" if type == "series" else "movie"
        results = await aiostreams.fetch_streams(stream_type, video_id)
        return {"imdb_id": imdb_id, "streams": results}
    except RuntimeError as exc:
        raise HTTPException(400, str(exc))
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"AIOStreams request failed: {exc}")
