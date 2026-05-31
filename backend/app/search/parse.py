import re

from ..torbox.client import magnet_from_hash

_RES_PATTERNS = [
    (re.compile(r"\b(4k|2160p|uhd)\b", re.I), "2160p"),
    (re.compile(r"\b1440p\b", re.I), "1440p"),
    (re.compile(r"\b1080p\b", re.I), "1080p"),
    (re.compile(r"\b720p\b", re.I), "720p"),
    (re.compile(r"\b480p\b", re.I), "480p"),
]

_CODEC_PATTERNS = [
    (re.compile(r"\b(av1)\b", re.I), "AV1"),
    (re.compile(r"\b(x265|h\.?265|hevc)\b", re.I), "HEVC"),
    (re.compile(r"\b(x264|h\.?264|avc)\b", re.I), "H264"),
]

_SOURCE_PATTERNS = [
    (re.compile(r"\bremux\b", re.I), "REMUX"),
    (re.compile(r"\b(bluray|bdrip|brrip)\b", re.I), "BluRay"),
    (re.compile(r"\bweb-?dl\b", re.I), "WEB-DL"),
    (re.compile(r"\bwebrip\b", re.I), "WEBRip"),
    (re.compile(r"\bhdtv\b", re.I), "HDTV"),
    (re.compile(r"\b(cam|hdcam|ts)\b", re.I), "CAM"),
]

_SIZE_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(GB|GiB|MB|MiB)", re.I)
# AIOStreams / Torrentio / Comet use varied seeder labels in name + description.
_SEED_PATTERNS = [
    re.compile(r"(?:👤|👥|🌱|⬆️?)\s*(\d+)\b"),
    re.compile(r"\b(?:seeders?|seeds?|peers?)\s*[:=]\s*(\d+)\b", re.I),
    re.compile(r"\b(\d+)\s*(?:seeders?|seeds?|peers?)\b", re.I),
    re.compile(r"\bS:\s*(\d+)\b", re.I),
]
_UNCACHED_PLACEHOLDER_RE = re.compile(
    r"not\s+yet\s+cached|not\s+cached|uncached|waiting\s+for\s+cache|"
    r"try\s+again\s+later|cache\s+in\s+progress",
    re.I,
)
_HDR_RE = re.compile(r"\b(hdr10\+|hdr10|hdr|dolby\s?vision|dovi|\bdv\b)\b", re.I)
_BTIH_RE = re.compile(r"btih:([a-fA-F0-9]{40})", re.I)

_RES_RANK = {"2160p": 5, "1440p": 4, "1080p": 3, "720p": 2, "480p": 1, "": 0}
_BINGE_RES_RE = re.compile(r"\|(2160p|1440p|1080p|720p|480p)\|", re.I)
_NAME_RES_SUFFIX = re.compile(r"\s+\d{3,4}p\s*$", re.I)


def _first(patterns, text: str) -> str:
    for rx, label in patterns:
        if rx.search(text):
            return label
    return ""


def _parse_seeders(text: str) -> int:
    best = 0
    for rx in _SEED_PATTERNS:
        for m in rx.finditer(text):
            try:
                best = max(best, int(m.group(1)))
            except ValueError:
                pass
    return best


def _is_uncached_placeholder(text: str, url: str) -> bool:
    blob = f"{text}\n{url}"
    if _UNCACHED_PLACEHOLDER_RE.search(blob):
        return True
    low = url.lower()
    return "not-cached" in low or "not_cached" in low or "uncached" in low


def _normalize_raw_stream(stream: dict) -> dict | None:
    """Unwrap AIOStreams streamData; drop error placeholders."""
    sd = stream.get("streamData")
    if not isinstance(sd, dict):
        return stream
    if sd.get("type") == "error":
        return None
    if sd.get("url") or sd.get("infoHash") or sd.get("magnet"):
        return {
            **sd,
            "name": stream.get("name") or sd.get("name", ""),
            "description": stream.get("description") or sd.get("description", ""),
            "behaviorHints": sd.get("behaviorHints") or stream.get("behaviorHints") or {},
        }
    return stream


def _magnet_and_hash(url: str, info_hash: str, text: str) -> tuple[str, str]:
    ih = (info_hash or "").strip().lower()
    if url.lower().startswith("magnet:"):
        m = _BTIH_RE.search(url)
        if m:
            ih = m.group(1).lower()
        return url, ih
    for blob in (url, text):
        m = _BTIH_RE.search(blob)
        if m:
            ih = m.group(1).lower()
            return magnet_from_hash(ih), ih
    if ih:
        return magnet_from_hash(ih), ih
    return "", ih


def _is_playback_proxy(url: str) -> bool:
    return "/playback/" in (url or "").lower()


def _torbox_uncached_marker(text: str) -> bool:
    return "TB⏳" in text or "TB⌛" in text


def _size_gb(text: str, size_bytes: int = 0) -> float:
    m = _SIZE_RE.search(text)
    if m:
        val = float(m.group(1))
        unit = m.group(2).lower()
        if unit.startswith("m"):
            return round(val / 1024, 2)
        return round(val, 2)
    if size_bytes > 0:
        return round(size_bytes / (1024**3), 2)
    return 0.0


def _parse_resolution(text: str, binge_group: str = "") -> str:
    """Pick resolution; avoid treating 'UHD-BDRip 1080p' as 2160p."""
    blob = f"{text}\n{binge_group}"
    labels: list[str] = []
    for rx, label in _RES_PATTERNS:
        if rx.search(blob):
            labels.append(label)
    m = _BINGE_RES_RE.search(binge_group or "")
    if m:
        labels.append(m.group(1).lower().replace("4k", "2160p"))
    if not labels:
        return ""
    has_sd_hd = any(l in labels for l in ("1080p", "720p", "480p", "1440p"))
    if has_sd_hd and "2160p" in labels:
        has_literal_4k = bool(re.search(r"\b(2160p|4k)\b", blob, re.I))
        if not has_literal_4k:
            labels = [l for l in labels if l != "2160p"]
    return max(labels, key=lambda l: _RES_RANK.get(l, 0))


def _parse_provider(name: str) -> str:
    n = name
    for tag in ("[TB⚡]", "[TB⏳]", "[TB⌛]"):
        n = n.replace(tag, "")
    n = _NAME_RES_SUFFIX.sub("", n).strip()
    return n


def parse_stream(stream: dict) -> dict | None:
    """Turn a raw Stremio stream object into structured, filterable metadata."""
    url = (stream.get("url") or "").strip()
    file_idx = stream.get("fileIdx")
    if file_idx is not None:
        try:
            file_idx = int(file_idx)
        except (TypeError, ValueError):
            file_idx = None

    name = stream.get("name", "") or ""
    desc = stream.get("description") or stream.get("title") or ""
    behavior = stream.get("behaviorHints", {}) or {}
    filename = (behavior.get("filename") or "").strip()
    binge_group = (behavior.get("bingeGroup") or "").strip()
    size_bytes = int(behavior.get("videoSize", 0) or 0)
    text = f"{name}\n{desc}\n{filename}\n{binge_group}"
    magnet, info_hash = _magnet_and_hash(url, (stream.get("infoHash") or "").strip(), text)
    if not url and not magnet:
        return None

    resolution = _parse_resolution(text, binge_group)
    hdr_m = _HDR_RE.search(text)
    cached = (
        "⚡" in text
        or "✅" in text
        or "cached" in text.lower()
        or "instant" in text.lower()
        or "in library" in text.lower()
    )
    seeders = _parse_seeders(text)
    torbox_uncached = _torbox_uncached_marker(text)
    playback_proxy = _is_playback_proxy(url)
    playable = bool(url) and not _is_uncached_placeholder(text, url)
    if torbox_uncached and playback_proxy:
        playable = False
    cacheable = bool(magnet) and not cached
    playback_cacheable = (
        not cached
        and not cacheable
        and playback_proxy
        and torbox_uncached
        and bool(url)
    )

    return {
        "url": url,
        "magnet": magnet,
        "info_hash": info_hash,
        "file_idx": file_idx,
        "name": name.replace("\n", " ").strip(),
        "description": desc.strip(),
        "filename": filename,
        "provider": _parse_provider(name),
        "resolution": resolution,
        "resolution_rank": _RES_RANK.get(resolution, 0),
        "codec": _first(_CODEC_PATTERNS, text),
        "source": _first(_SOURCE_PATTERNS, text),
        "hdr": hdr_m.group(0).upper() if hdr_m else "",
        "size_gb": _size_gb(text, size_bytes),
        "size_bytes": size_bytes,
        "seeders": seeders,
        "cached": cached,
        "playable": playable,
        "cacheable": cacheable,
        "playback_cacheable": playback_cacheable,
    }


def parse_streams(streams: list[dict]) -> list[dict]:
    out = []
    for raw in streams:
        norm = _normalize_raw_stream(raw)
        if norm and (p := parse_stream(norm)):
            out.append(p)
    out.sort(key=lambda x: (x["resolution_rank"], x["cached"], x["seeders"]), reverse=True)
    return out
