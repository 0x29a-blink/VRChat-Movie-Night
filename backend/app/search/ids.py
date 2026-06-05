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


def is_torbox_library_catalog(
    catalog_id: str,
    catalog_name: str = "",
    catalog_type: str = "",
) -> bool:
    """TorBox 'Library' catalog in AIOStreams — items are already on the debrid account."""
    cid = (catalog_id or "").strip().lower()
    cname = (catalog_name or "").strip().lower()
    ctype = (catalog_type or "").strip().lower()
    if "library" in cid:
        return True
    if "library" in cname and ("torbox" in cid or "torbox" in cname or ctype == "other"):
        return True
    return cname in ("library", "my library", "torbox library")


def parse_torbox_catalog_ids(stremio_id: str) -> tuple[int | None, int | None]:
    """Parse TorBox library meta ids (torrent id, optional file id)."""
    sid = (stremio_id or "").strip()
    if not sid:
        return None, None
    if ":" in sid and not sid.startswith(("tmdb:", "tt", "kitsu:", "mal:", "anilist:")):
        left, right = sid.split(":", 1)
        if left.isdigit():
            tid = int(left)
            fid = int(right) if right.isdigit() else None
            return tid, fid
    if sid.isdigit():
        return int(sid), None
    return None, None
