"""Resolve AIOStreams catalog clicks into playable titles or sub-collections."""

from urllib.parse import quote

import httpx

from . import catalog, tmdb
from .ids import anilist_id, collection_id, kitsu_id, mal_id


async def open_item(stremio_id: str, media_type: str) -> dict:
    sid = (stremio_id or "").strip()
    cid = collection_id(sid)
    if cid is not None:
        return await _open_collection(cid)

    kid = kitsu_id(sid)
    if kid is not None:
        title = await _title_from_kitsu(kid)
        return {"action": "title", "title": await tmdb.resolve_by_name(title, "series")}

    mid = mal_id(sid)
    if mid is not None:
        title = await _title_from_mal(mid)
        return {"action": "title", "title": await tmdb.resolve_by_name(title, "series")}

    aid = anilist_id(sid)
    if aid is not None:
        title = await _title_from_anilist(aid)
        return {"action": "title", "title": await tmdb.resolve_by_name(title, "series")}

    # Meta with embedded episode list (some collection pages)
    if sid.startswith("ctmdb"):
        meta = await _try_fetch_meta(media_type, sid)
        if meta and meta.get("videos"):
            movies = await _movies_from_meta_videos(meta.get("videos") or [])
            if movies:
                return {
                    "action": "collection",
                    "collection_id": 0,
                    "name": meta.get("name") or "",
                    "overview": meta.get("description") or "",
                    "poster": meta.get("poster") or "",
                    "movies": movies,
                }

    return {"action": "title", "title": await tmdb.resolve_stremio_id(sid, media_type)}


async def _open_collection(collection_id: int) -> dict:
    data = await tmdb.collection_movies(collection_id)
    return {"action": "collection", **data}


async def _try_fetch_meta(media_type: str, stremio_id: str) -> dict | None:
    try:
        encoded = quote(stremio_id, safe="")
        path_type = "anime" if media_type == "anime" else media_type
        for t in (path_type, media_type, "movie", "series"):
            try:
                data = await catalog._get_json(f"/meta/{t}/{encoded}.json")
                meta = data.get("meta")
                if meta and meta.get("id"):
                    return meta
            except httpx.HTTPError:
                continue
    except Exception:
        pass
    return None


async def _movies_from_meta_videos(videos: list[dict]) -> list[dict]:
    out: list[dict] = []
    for vid in videos:
        vid_id = (vid.get("id") or "").strip()
        if not vid_id.startswith("tt"):
            continue
        try:
            tmdb_id = await tmdb.find_by_imdb(vid_id, "movie")
            if not tmdb_id:
                continue
            async with httpx.AsyncClient() as client:
                data = await tmdb._get(client, f"/movie/{tmdb_id}", {})
            item = tmdb._search_result_from_tmdb(data, "movie")
            item["tmdb_id"] = tmdb_id
            if vid.get("title"):
                item["title"] = vid["title"]
            out.append(item)
        except Exception:
            continue
    return out


async def _title_from_kitsu(kitsu_id: int) -> str:
    url = f"https://kitsu.io/api/edge/anime/{kitsu_id}"
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            url,
            timeout=15,
            headers={"Accept": "application/vnd.api+json"},
        )
        resp.raise_for_status()
        data = resp.json()
    attrs = data.get("data", {}).get("attributes", {})
    titles = attrs.get("titles") or {}
    return (
        titles.get("en")
        or titles.get("en_jp")
        or attrs.get("canonicalTitle")
        or attrs.get("slug")
        or ""
    )


async def _title_from_mal(mal_id: int) -> str:
    url = f"https://api.jikan.moe/v4/anime/{mal_id}"
    async with httpx.AsyncClient() as client:
        resp = await client.get(url, timeout=20)
        resp.raise_for_status()
        data = resp.json().get("data") or {}
    return data.get("title_english") or data.get("title") or ""


async def _title_from_anilist(anilist_id: int) -> str:
    query = """
    query ($id: Int) {
      Media(id: $id, type: ANIME) { title { english romaji userPreferred } }
    }
    """
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            "https://graphql.anilist.co",
            json={"query": query, "variables": {"id": anilist_id}},
            timeout=15,
        )
        resp.raise_for_status()
        media = resp.json().get("data", {}).get("Media") or {}
    title = media.get("title") or {}
    return title.get("english") or title.get("userPreferred") or title.get("romaji") or ""
