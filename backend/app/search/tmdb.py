import re
import unicodedata

import httpx

from .. import settings_store
from .numbers import safe_float

TMDB_API = "https://api.themoviedb.org/3"
TMDB_IMG = "https://image.tmdb.org/t/p/w342"
_MIDDLE_DOT = "\u00b7"


def _key() -> str:
    return settings_store.get("tmdb_api_key", "") or ""


def normalize_title_for_match(text: str) -> str:
    """Fold punctuation variants (WALL-E, WALL·E, WALL.E) to a comparable token."""
    if not text:
        return ""
    folded = unicodedata.normalize("NFKD", text).lower()
    for ch in "-_.·:'\" ":
        folded = folded.replace(ch, "")
    return re.sub(r"[^a-z0-9]", "", folded)


def search_query_variants(query: str) -> list[str]:
    """Generate TMDB query variants for titles with punctuation quirks."""
    q = (query or "").strip()
    if not q:
        return []

    variants: list[str] = []

    def add(value: str) -> None:
        value = value.strip()
        if value and value not in variants:
            variants.append(value)

    add(q)
    for src, dst in (
        ("-", _MIDDLE_DOT),
        ("-", " "),
        ("-", "."),
        (".", _MIDDLE_DOT),
        (_MIDDLE_DOT, "-"),
        (" ", _MIDDLE_DOT),
    ):
        if src in q:
            add(q.replace(src, dst))
    add(re.sub(r"[^\w\s]+", " ", q))
    add(re.sub(r"[^\w\s]+", "", q))
    return variants


def title_match_score(query: str, title: str) -> float:
    nq = normalize_title_for_match(query)
    nt = normalize_title_for_match(title)
    if not nq or not nt:
        return 0.0
    if nq == nt:
        return 100.0
    if nt.startswith(nq) or nq.startswith(nt):
        return 80.0
    if nq in nt or nt in nq:
        return 60.0
    return 0.0


def _result_from_multi_item(item: dict) -> dict | None:
    media_type = item.get("media_type")
    if media_type not in ("movie", "tv"):
        return None
    poster = item.get("poster_path")
    return {
        "tmdb_id": item.get("id"),
        "type": "movie" if media_type == "movie" else "series",
        "title": item.get("title") or item.get("name") or "",
        "year": (item.get("release_date") or item.get("first_air_date") or "")[:4],
        "overview": item.get("overview", ""),
        "poster": f"{TMDB_IMG}{poster}" if poster else "",
        "rating": safe_float(item.get("vote_average"), 0.0),
        "_popularity": safe_float(item.get("popularity"), 0.0),
    }


def _rank_search_results(query: str, rows: list[dict]) -> list[dict]:
    ranked = sorted(
        rows,
        key=lambda row: (
            -title_match_score(query, row.get("title") or ""),
            -float(row.get("_popularity") or 0.0),
            row.get("title") or "",
        ),
    )
    for row in ranked:
        row.pop("_popularity", None)
    return ranked


async def _search_multi(client: httpx.AsyncClient, query: str) -> list[dict]:
    data = await _get(client, "/search/multi", {"query": query, "include_adult": "false"})
    out: list[dict] = []
    for item in data.get("results", []):
        row = _result_from_multi_item(item)
        if row:
            out.append(row)
    return out


async def _search_movie(client: httpx.AsyncClient, query: str) -> list[dict]:
    data = await _get(client, "/search/movie", {"query": query})
    out: list[dict] = []
    for item in data.get("results", []) or []:
        row = _search_result_from_tmdb(item, "movie")
        row["_popularity"] = safe_float(item.get("popularity"), 0.0)
        out.append(row)
    return out


async def _search_tv(client: httpx.AsyncClient, query: str) -> list[dict]:
    data = await _get(client, "/search/tv", {"query": query})
    out: list[dict] = []
    for item in data.get("results", []) or []:
        row = _search_result_from_tmdb(item, "series")
        row["_popularity"] = safe_float(item.get("popularity"), 0.0)
        out.append(row)
    return out


async def _collect_ranked_results(
    client: httpx.AsyncClient,
    query: str,
    *,
    search_fn,
) -> list[dict]:
    seen: dict[int, dict] = {}
    for variant in search_query_variants(query):
        for row in await search_fn(client, variant):
            tid = row.get("tmdb_id")
            if not tid or tid in seen:
                continue
            seen[tid] = row
    return _rank_search_results(query, list(seen.values()))


def _pick_best_result(query: str, results: list[dict]) -> dict | None:
    if not results:
        return None
    ranked = _rank_search_results(query, [dict(row) for row in results])
    return ranked[0]


async def _get(client: httpx.AsyncClient, path: str, params: dict) -> dict:
    params = {**params, "api_key": _key()}
    resp = await client.get(f"{TMDB_API}{path}", params=params, timeout=15)
    resp.raise_for_status()
    return resp.json()


async def search(query: str) -> list[dict]:
    if not _key():
        raise RuntimeError("TMDB API key is not configured (Settings page).")
    async with httpx.AsyncClient() as client:
        return await _collect_ranked_results(client, query, search_fn=_search_multi)


async def external_ids(tmdb_id: int, type_: str) -> dict:
    """Return imdb_id (tt...) for a TMDB title."""
    kind = "movie" if type_ == "movie" else "tv"
    async with httpx.AsyncClient() as client:
        data = await _get(client, f"/{kind}/{tmdb_id}/external_ids", {})
    return {"imdb_id": data.get("imdb_id", "")}


async def find_by_imdb(imdb_id: str, type_: str) -> int | None:
    """Map tt… id to TMDB numeric id."""
    imdb_id = imdb_id.strip()
    if not imdb_id.startswith("tt"):
        return None
    async with httpx.AsyncClient() as client:
        data = await _get(client, f"/find/{imdb_id}", {"external_source": "imdb_id"})
    if type_ == "series":
        results = data.get("tv_results") or []
    else:
        results = data.get("movie_results") or []
    if not results:
        # fallback: try the other kind
        alt = data.get("movie_results") if type_ == "series" else data.get("tv_results")
        results = alt or []
    return results[0].get("id") if results else None


def _search_result_from_tmdb(item: dict, type_: str) -> dict:
    poster = item.get("poster_path")
    return {
        "tmdb_id": item.get("id"),
        "type": type_,
        "title": item.get("title") or item.get("name") or "",
        "year": (item.get("release_date") or item.get("first_air_date") or "")[:4],
        "overview": item.get("overview", ""),
        "poster": f"{TMDB_IMG}{poster}" if poster else "",
        "rating": safe_float(item.get("vote_average"), 0.0),
    }


async def resolve_by_name(title: str, media_type: str = "series") -> dict:
    """Find a TMDB entry by display name (used for anime id fallbacks)."""
    title = (title or "").strip()
    if not title:
        raise RuntimeError("No title to search for.")
    if not _key():
        raise RuntimeError("TMDB API key is not configured (Settings page).")
    kind = "series" if media_type in ("series", "tv", "anime") else "movie"
    async with httpx.AsyncClient() as client:
        if kind == "series":
            results = await _collect_ranked_results(client, title, search_fn=_search_tv)
            if not results:
                results = [
                    row
                    for row in await _collect_ranked_results(client, title, search_fn=_search_multi)
                    if row.get("type") == "series"
                ]
        else:
            results = await _collect_ranked_results(client, title, search_fn=_search_movie)
    picked = _pick_best_result(title, results)
    if not picked:
        raise RuntimeError(f"Could not find '{title}' on TMDB. Try TMDB search instead.")
    out = dict(picked)
    out.pop("_popularity", None)
    return out


async def resolve_stremio_id(stremio_id: str, media_type: str) -> dict:
    """Turn a Stremio/AIOStreams meta id into a SearchResult-shaped dict."""
    sid = (stremio_id or "").strip()
    kind = "series" if media_type in ("series", "tv", "anime") else "movie"

    tmdb_id: int | None = None
    if re.match(r"^ctmdb[.:]", sid, re.I):
        raise RuntimeError(
            f"'{sid}' is a TMDB collection. Open it in Browse to see its movies."
        )
    if sid.startswith("tmdb:"):
        try:
            tmdb_id = int(sid.split(":", 1)[1])
        except ValueError:
            tmdb_id = None
    elif sid.isdigit():
        tmdb_id = int(sid)
    elif sid.startswith("tt"):
        tmdb_id = await find_by_imdb(sid, kind)

    if not tmdb_id:
        raise RuntimeError(
            f"Could not map id '{sid}' to TMDB. Try TMDB search instead."
        )

    async with httpx.AsyncClient() as client:
        path_kind = "movie" if kind == "movie" else "tv"
        data = await _get(client, f"/{path_kind}/{tmdb_id}", {})
    out = _search_result_from_tmdb(data, kind)
    out["tmdb_id"] = tmdb_id
    return out


async def search_collections(query: str) -> list[dict]:
    if not _key():
        raise RuntimeError("TMDB API key is not configured (Settings page).")
    async with httpx.AsyncClient() as client:
        data = await _get(client, "/search/collection", {"query": query})
    out: list[dict] = []
    for item in data.get("results", []):
        poster = item.get("poster_path")
        out.append(
            {
                "collection_id": item.get("id"),
                "name": item.get("name") or "",
                "overview": item.get("overview", ""),
                "poster": f"{TMDB_IMG}{poster}" if poster else "",
            }
        )
    return out


async def collection_movies(collection_id: int) -> dict:
    if not _key():
        raise RuntimeError("TMDB API key is not configured (Settings page).")
    async with httpx.AsyncClient() as client:
        data = await _get(client, f"/collection/{collection_id}", {})
    parts = sorted(data.get("parts") or [], key=lambda p: p.get("release_date") or "")
    movies = [_search_result_from_tmdb(p, "movie") for p in parts if p.get("id")]
    poster = data.get("poster_path")
    return {
        "collection_id": collection_id,
        "name": data.get("name") or "",
        "overview": data.get("overview", ""),
        "poster": f"{TMDB_IMG}{poster}" if poster else "",
        "movies": movies,
    }


async def details(tmdb_id: int, type_: str) -> dict:
    kind = "movie" if type_ == "movie" else "tv"
    async with httpx.AsyncClient() as client:
        data = await _get(client, f"/{kind}/{tmdb_id}", {})
    seasons = []
    for season in data.get("seasons", []) or []:
        if season.get("season_number", 0) == 0:
            continue
        seasons.append(
            {
                "season_number": season.get("season_number"),
                "name": season.get("name"),
                "episode_count": season.get("episode_count", 0),
            }
        )
    return {
        "tmdb_id": tmdb_id,
        "type": type_,
        "title": data.get("title") or data.get("name") or "",
        "overview": data.get("overview", ""),
        "year": (data.get("release_date") or data.get("first_air_date") or "")[:4],
        "poster": f"{TMDB_IMG}{poster}" if (poster := data.get("poster_path")) else "",
        "seasons": seasons,
    }


async def season_episodes(tmdb_id: int, season: int) -> list[dict]:
    if not _key():
        raise RuntimeError("TMDB API key is not configured (Settings page).")
    async with httpx.AsyncClient() as client:
        data = await _get(client, f"/tv/{tmdb_id}/season/{season}", {})
    out = []
    for ep in data.get("episodes", []) or []:
        still = ep.get("still_path")
        out.append(
            {
                "episode_number": ep.get("episode_number"),
                "name": ep.get("name") or "",
                "overview": ep.get("overview", ""),
                "air_date": ep.get("air_date") or "",
                "still": f"{TMDB_IMG}{still}" if still else "",
            }
        )
    return out


async def all_episodes(tmdb_id: int) -> list[dict]:
    """Every episode across regular seasons (skips specials)."""
    info = await details(tmdb_id, "series")
    out: list[dict] = []
    for season in info.get("seasons", []):
        sn = season.get("season_number")
        if sn is None or sn <= 0:
            continue
        for ep in await season_episodes(tmdb_id, sn):
            en = ep.get("episode_number")
            if en is None:
                continue
            out.append(
                {
                    "season": sn,
                    "episode": en,
                    "title": ep.get("name") or f"S{sn}E{en}",
                    "still": ep.get("still") or "",
                    "overview": ep.get("overview") or "",
                    "air_date": ep.get("air_date") or "",
                }
            )
    return out
