import httpx
from fastapi import APIRouter, Depends, HTTPException, Query

from .. import auth
from ..search import aiostreams, anime_meta, stremio_streams, tmdb

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


@router.get("/streams/stremio")
async def streams_stremio(
    video_id: str = Query(..., min_length=3),
    stremio_id: str | None = Query(None),
    season: int | None = Query(None),
    episode: int | None = Query(None),
):
    """Streams for Kitsu/MAL/AniList video ids (from meta video.id)."""
    try:
        vid = video_id.strip()
        if not vid and stremio_id:
            meta = await anime_meta.fetch_stremio_meta(stremio_id.strip())
            if not meta:
                raise HTTPException(404, "No meta for anime id")
            vid = anime_meta.default_video_id(meta, stremio_id.strip(), season, episode)
        resolved_id, results = await stremio_streams.fetch_streams_for_video_id(vid)
        return {"video_id": resolved_id, "streams": results}
    except RuntimeError as exc:
        raise HTTPException(400, str(exc)) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"AIOStreams request failed: {exc}") from exc


@router.get("/streams")
async def streams(
    tmdb_id: int = Query(...),
    type: str = Query("movie"),
    season: int | None = Query(None),
    episode: int | None = Query(None),
):
    try:
        ext = await tmdb.external_ids(tmdb_id, type)
        imdb_id = ext.get("imdb_id") or ""
        stream_type = "series" if type == "series" else "movie"

        video_ids: list[str] = []
        if imdb_id:
            video_ids.append(aiostreams.build_video_id(imdb_id, season, episode))
        tmdb_video = aiostreams.build_video_id(f"tmdb:{tmdb_id}", season, episode)
        if tmdb_video not in video_ids:
            video_ids.append(tmdb_video)

        results: list[dict] = []
        resolved_id = video_ids[0] if video_ids else ""
        for video_id in video_ids:
            try:
                batch = await aiostreams.fetch_streams(stream_type, video_id)
            except httpx.HTTPError:
                continue
            if batch:
                return {"imdb_id": imdb_id or None, "video_id": video_id, "streams": batch}
            results = batch
            resolved_id = video_id

        if not video_ids:
            raise HTTPException(404, "No IMDB id found for this title")

        return {"imdb_id": imdb_id or None, "video_id": resolved_id, "streams": results}
    except RuntimeError as exc:
        raise HTTPException(400, str(exc))
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"AIOStreams request failed: {exc}")
