"""Anime title/episode meta from Kitsu, MAL, AniList (AIOStreams catalogs omit /meta for these ids)."""

from __future__ import annotations

from urllib.parse import quote

import httpx

from . import catalog
from .ids import anilist_id, kitsu_id, mal_id
from .numbers import safe_float

_ANIME_ID_PREFIXES = ("kitsu:", "mal:", "anilist:")
_KITSU_HEADERS = {"Accept": "application/vnd.api+json"}


def is_anime_stremio_id(stremio_id: str) -> bool:
    sid = (stremio_id or "").strip().lower()
    return any(sid.startswith(p) for p in _ANIME_ID_PREFIXES)


async def fetch_stremio_meta(stremio_id: str, media_type: str = "series") -> dict | None:
    """Load meta for kitsu/mal/anilist ids; optional AIOStreams /meta for supported prefixes."""
    sid = stremio_id.strip()
    if is_anime_stremio_id(sid):
        native = await _fetch_native_anime_meta(sid)
        if native:
            return native
        return None
    return await _fetch_aiostreams_meta(sid, media_type)


async def _fetch_native_anime_meta(stremio_id: str) -> dict | None:
    kid = kitsu_id(stremio_id)
    if kid is not None:
        return await _fetch_kitsu_meta(kid, stremio_id)
    mid = mal_id(stremio_id)
    if mid is not None:
        return await _fetch_mal_meta(mid, stremio_id)
    aid = anilist_id(stremio_id)
    if aid is not None:
        return await _fetch_anilist_meta(aid, stremio_id)
    return None


async def _fetch_aiostreams_meta(stremio_id: str, media_type: str) -> dict | None:
    encoded = quote(stremio_id.strip(), safe="")
    types: list[str] = []
    for t in (media_type, "anime", "series", "movie"):
        if t and t not in types:
            types.append(t)
    for t in types:
        data = await catalog.try_get_json(f"/meta/{t}/{encoded}.json")
        if not data:
            continue
        meta = data.get("meta")
        if meta and meta.get("id"):
            return meta
    return None


async def _fetch_kitsu_meta(kitsu_num: int, stremio_id: str) -> dict | None:
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"https://kitsu.io/api/edge/anime/{kitsu_num}",
            timeout=20,
            headers=_KITSU_HEADERS,
        )
        resp.raise_for_status()
        payload = resp.json()
        attrs = (payload.get("data") or {}).get("attributes") or {}
        videos = await _kitsu_episode_videos(client, kitsu_num)
    return _build_meta(
        stremio_id,
        name=_kitsu_title(attrs),
        description=attrs.get("synopsis") or "",
        poster=_kitsu_poster(attrs),
        release_info=_kitsu_year(attrs),
        rating=safe_float(attrs.get("averageRating"), 0.0),
        videos=videos,
    )


async def _kitsu_episode_videos(client: httpx.AsyncClient, kitsu_num: int) -> list[dict]:
    videos: list[dict] = []
    url: str | None = f"https://kitsu.io/api/edge/anime/{kitsu_num}/episodes?page[limit]=20"
    while url:
        resp = await client.get(url, timeout=30, headers=_KITSU_HEADERS)
        resp.raise_for_status()
        payload = resp.json()
        for item in payload.get("data") or []:
            a = item.get("attributes") or {}
            ep_num = int(a.get("number") or 0)
            if ep_num <= 0:
                continue
            videos.append(
                _video_row(
                    f"kitsu:{kitsu_num}:{ep_num}",
                    season=int(a.get("seasonNumber") or 1),
                    episode=ep_num,
                    title=a.get("canonicalTitle") or a.get("title") or f"Episode {ep_num}",
                    thumbnail=(a.get("thumbnail") or {}).get("original") or "",
                    released=(a.get("airdate") or "")[:10],
                    overview=a.get("synopsis") or "",
                )
            )
        url = (payload.get("links") or {}).get("next")
    videos.sort(key=lambda v: (v["season"], v["episode"]))
    return videos


async def _fetch_mal_meta(mal_num: int, stremio_id: str) -> dict | None:
    async with httpx.AsyncClient() as client:
        resp = await client.get(f"https://api.jikan.moe/v4/anime/{mal_num}/full", timeout=25)
        resp.raise_for_status()
        data = resp.json().get("data") or {}
        videos = await _mal_episode_videos(client, mal_num)
    return _build_meta(
        stremio_id,
        name=data.get("title_english") or data.get("title") or "",
        description=data.get("synopsis") or "",
        poster=(data.get("images") or {}).get("jpg", {}).get("large_image_url") or "",
        release_info=str((data.get("year") or "") or ""),
        rating=safe_float((data.get("score") or 0), 0.0),
        videos=videos,
    )


async def _mal_episode_videos(client: httpx.AsyncClient, mal_num: int) -> list[dict]:
    videos: list[dict] = []
    page = 1
    while True:
        resp = await client.get(
            f"https://api.jikan.moe/v4/anime/{mal_num}/episodes",
            params={"page": page},
            timeout=25,
        )
        resp.raise_for_status()
        payload = resp.json()
        for ep in payload.get("data") or []:
            ep_num = int(ep.get("mal_id") or ep.get("episode") or 0)
            if ep_num <= 0:
                continue
            aired = (ep.get("aired") or "")[:10]
            videos.append(
                _video_row(
                    f"mal:{mal_num}:{ep_num}",
                    season=1,
                    episode=ep_num,
                    title=ep.get("title") or f"Episode {ep_num}",
                    thumbnail="",
                    released=aired,
                    overview="",
                )
            )
        pagination = payload.get("pagination") or {}
        if not pagination.get("has_next_page"):
            break
        page += 1
    return videos


async def _fetch_anilist_meta(anilist_num: int, stremio_id: str) -> dict | None:
    query = """
    query ($id: Int) {
      Media(id: $id, type: ANIME) {
        title { english romaji userPreferred }
        description(asHtml: false)
        coverImage { extraLarge large }
        startDate { year }
        averageScore
        episodes
      }
    }
    """
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            "https://graphql.anilist.co",
            json={"query": query, "variables": {"id": anilist_num}},
            timeout=20,
        )
        resp.raise_for_status()
        media = resp.json().get("data", {}).get("Media") or {}
    title = media.get("title") or {}
    name = title.get("english") or title.get("userPreferred") or title.get("romaji") or ""
    cover = media.get("coverImage") or {}
    ep_count = int(media.get("episodes") or 0)
    videos = _anilist_synthetic_videos(anilist_num, ep_count)
    year = (media.get("startDate") or {}).get("year")
    return _build_meta(
        stremio_id,
        name=name,
        description=media.get("description") or "",
        poster=cover.get("extraLarge") or cover.get("large") or "",
        release_info=str(year or ""),
        rating=safe_float((media.get("averageScore") or 0) / 10.0, 0.0),
        videos=videos,
    )


def _anilist_synthetic_videos(anilist_num: int, episode_count: int) -> list[dict]:
    if episode_count <= 0:
        return [
            _video_row(
                f"anilist:{anilist_num}:1",
                season=1,
                episode=1,
                title="Episode 1",
            )
        ]
    return [
        _video_row(
            f"anilist:{anilist_num}:{n}",
            season=1,
            episode=n,
            title=f"Episode {n}",
        )
        for n in range(1, episode_count + 1)
    ]


def _video_row(
    vid_id: str,
    *,
    season: int = 1,
    episode: int = 1,
    title: str = "",
    thumbnail: str = "",
    released: str = "",
    overview: str = "",
) -> dict:
    return {
        "id": vid_id,
        "season": season,
        "episode": episode,
        "title": title,
        "thumbnail": thumbnail,
        "released": released,
        "overview": overview,
    }


def _build_meta(
    stremio_id: str,
    *,
    name: str,
    description: str,
    poster: str,
    release_info: str,
    rating: float,
    videos: list[dict],
) -> dict:
    hints: dict = {}
    if videos:
        hints["defaultVideoId"] = videos[0]["id"]
    return {
        "id": stremio_id,
        "type": "series",
        "name": name,
        "description": description,
        "poster": poster,
        "releaseInfo": release_info,
        "imdbRating": rating if rating > 0 else None,
        "videos": videos,
        "behaviorHints": hints,
    }


def _kitsu_title(attrs: dict) -> str:
    titles = attrs.get("titles") or {}
    return (
        titles.get("en")
        or titles.get("en_jp")
        or attrs.get("canonicalTitle")
        or attrs.get("slug")
        or ""
    )


def _kitsu_poster(attrs: dict) -> str:
    poster = attrs.get("posterImage") or {}
    return poster.get("large") or poster.get("medium") or poster.get("original") or ""


def _kitsu_year(attrs: dict) -> str:
    start = attrs.get("startDate") or ""
    return str(start)[:4] if start else ""


def meta_to_search_result(meta: dict, stremio_id: str) -> dict:
    poster = meta.get("poster") or ""
    rating_raw = meta.get("imdbRating")
    rating = 0.0
    if rating_raw is not None and str(rating_raw).strip().lower() not in ("", "nan", "n/a", "none"):
        rating = safe_float(str(rating_raw).split("/")[0].strip(), 0.0)
    return {
        "tmdb_id": 0,
        "type": "series",
        "title": meta.get("name") or "",
        "year": (meta.get("releaseInfo") or "")[:4],
        "overview": meta.get("description") or "",
        "poster": poster,
        "rating": rating,
        "stremio_id": stremio_id.strip(),
        "anime_native": True,
    }


def seasons_from_meta(meta: dict) -> list[dict]:
    videos = meta.get("videos") or []
    if not videos:
        return [{"season_number": 1, "name": "Season 1", "episode_count": 0}]
    by_season: dict[int, int] = {}
    for vid in videos:
        s = int(vid.get("season") or 1)
        by_season[s] = by_season.get(s, 0) + 1
    return [
        {
            "season_number": s,
            "name": f"Season {s}",
            "episode_count": count,
        }
        for s, count in sorted(by_season.items())
    ]


def episodes_for_season(meta: dict, season: int) -> list[dict]:
    out: list[dict] = []
    for vid in meta.get("videos") or []:
        if int(vid.get("season") or 1) != season:
            continue
        released = (vid.get("released") or "")[:10]
        out.append(
            {
                "episode_number": int(vid.get("episode") or len(out) + 1),
                "name": vid.get("title") or f"Episode {vid.get('episode') or ''}",
                "overview": vid.get("overview") or "",
                "air_date": released,
                "still": vid.get("thumbnail") or "",
                "video_stremio_id": (vid.get("id") or "").strip(),
            }
        )
    out.sort(key=lambda e: e["episode_number"])
    return out


def default_video_id(meta: dict, stremio_id: str, season: int | None, episode: int | None) -> str:
    if season is not None and episode is not None:
        for vid in meta.get("videos") or []:
            if int(vid.get("season") or 1) == season and int(vid.get("episode") or 0) == episode:
                vid_id = (vid.get("id") or "").strip()
                if vid_id:
                    return vid_id
        base = stremio_id.strip()
        parts = base.split(":")
        if len(parts) == 2 and parts[0] in ("kitsu", "mal", "anilist"):
            return f"{base}:{episode}"
        return f"{base}:{season}:{episode}"
    hints = meta.get("behaviorHints") or {}
    default = (hints.get("defaultVideoId") or "").strip()
    if default:
        return default
    videos = meta.get("videos") or []
    if videos:
        return (videos[0].get("id") or stremio_id).strip()
    return stremio_id.strip()


async def resolve_anime_title(stremio_id: str) -> dict | None:
    """Return SearchResult-shaped dict from native meta, or None to fall back."""
    if not is_anime_stremio_id(stremio_id):
        return None
    meta = await fetch_stremio_meta(stremio_id, "anime")
    if not meta:
        return None
    return meta_to_search_result(meta, stremio_id)


def sort_catalogs_for_display(catalogs: list[dict]) -> list[dict]:
    def rank(c: dict) -> tuple[int, str]:
        text = f"{c.get('type', '')} {c.get('id', '')} {c.get('name', '')}".lower()
        if c.get("type") == "anime":
            return (0, text)
        if "kitsu" in text:
            return (1, text)
        if "mal" in text or "anilist" in text:
            return (2, text)
        if "anime" in text:
            return (3, text)
        return (10, text)

    return sorted(catalogs, key=rank)


def pick_anime_catalog_key(catalogs: list[dict]) -> str | None:
    if not catalogs:
        return None
    sorted_c = sort_catalogs_for_display(catalogs)
    first = sorted_c[0]
    return f"{first.get('type', '')}:{first.get('id', '')}"
