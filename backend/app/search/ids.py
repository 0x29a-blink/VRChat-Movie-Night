import re

_COLLECTION_RE = re.compile(r"^ctmdb[.:](\d+)$", re.I)
_KITSU_RE = re.compile(r"^kitsu:(\d+)$", re.I)
_MAL_RE = re.compile(r"^mal:(\d+)$", re.I)
_ANILIST_RE = re.compile(r"^anilist:(\d+)$", re.I)


def classify_id(stremio_id: str) -> str:
    sid = (stremio_id or "").strip()
    if _COLLECTION_RE.match(sid):
        return "collection"
    if _KITSU_RE.match(sid) or _MAL_RE.match(sid) or _ANILIST_RE.match(sid):
        return "anime"
    return "title"


def collection_id(stremio_id: str) -> int | None:
    m = _COLLECTION_RE.match((stremio_id or "").strip())
    return int(m.group(1)) if m else None


def kitsu_id(stremio_id: str) -> int | None:
    m = _KITSU_RE.match((stremio_id or "").strip())
    return int(m.group(1)) if m else None


def mal_id(stremio_id: str) -> int | None:
    m = _MAL_RE.match((stremio_id or "").strip())
    return int(m.group(1)) if m else None


def anilist_id(stremio_id: str) -> int | None:
    m = _ANILIST_RE.match((stremio_id or "").strip())
    return int(m.group(1)) if m else None
