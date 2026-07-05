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

_DUB_RE = re.compile(
    r"\b(?:english[\s-]*)?dub(?:bed)?\b|\beng[\s-]*dub\b|\benglish[\s-]*(?:audio|track)\b",
    re.I,
)
_DUAL_RE = re.compile(
    r"\bdual[\s.-]*audio\b|\bmulti[\s.-]*audio\b|\b2[\s.]0.*2[\s.]0\b",
    re.I,
)
_SUB_RE = re.compile(r"\b(?:sub(?:bed)?|vostfr|fansub|subs?only)\b", re.I)
_RAW_RE = re.compile(r"\b(?:raw|japanese[\s-]*audio)\b", re.I)
_JPN_RE = re.compile(r"\b(?:jpn|japanese|ja)\b", re.I)
_ENG_TAG_RE = re.compile(r"\[(?:eng|english)\]|\beng\b(?=[\s\.\-\]]|$)", re.I)
_HARDSUB_RE = re.compile(r"\b(?:hardsub|hsub|hard[\s-]?sub)\b", re.I)
_SOFTSUB_RE = re.compile(r"\b(?:soft[\s-]?sub(?:s)?|softsubs?)\b", re.I)

_RES_RANK = {"2160p": 5, "1440p": 4, "1080p": 3, "720p": 2, "480p": 1, "": 0}
_AUDIO_LANG_RANK = {"dub": 3, "dual": 2, "sub": 1, "": 0}
_BINGE_RES_RE = re.compile(r"\|(2160p|1440p|1080p|720p|480p)\|", re.I)
_NAME_RES_SUFFIX = re.compile(r"\s+\d{3,4}p\s*$", re.I)
_FMT_LANG_LINE = re.compile(r"🌎\s*(.+)", re.U)
_FMT_SUB_LINE = re.compile(r"📝\s*(.+)", re.U)

_ENGLISH_LANG = frozenset({"english", "eng"})
_JAPANESE_LANG = frozenset({"japanese", "jpn", "ja", "japanese audio"})


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
    if sd.get("type") == "error" or sd.get("error"):
        return None

    torrent = sd.get("torrent") if isinstance(sd.get("torrent"), dict) else {}
    url = (sd.get("url") or stream.get("url") or torrent.get("url") or "").strip()
    info_hash = (
        sd.get("infoHash") or stream.get("infoHash") or torrent.get("infoHash") or ""
    ).strip()
    magnet = (sd.get("magnet") or torrent.get("magnet") or "").strip()
    if magnet and not url:
        url = magnet

    if url or info_hash or magnet:
        merged: dict = {
            **sd,
            "url": url,
            "name": stream.get("name") or sd.get("name", ""),
            "description": stream.get("description") or sd.get("description", ""),
            "behaviorHints": sd.get("behaviorHints") or stream.get("behaviorHints") or {},
            "_aiostreams_parent": stream,
        }
        if info_hash:
            merged["infoHash"] = info_hash
        if magnet:
            merged["magnet"] = magnet
        file_idx = sd.get("fileIdx")
        if file_idx is None:
            file_idx = stream.get("fileIdx")
        if file_idx is None:
            file_idx = torrent.get("fileIdx")
        if file_idx is not None:
            merged["fileIdx"] = file_idx
        return merged

    if stream.get("url") or stream.get("infoHash"):
        return stream
    return stream


def _string_list(val) -> list[str]:
    if not val:
        return []
    if not isinstance(val, list):
        return []
    out: list[str] = []
    for item in val:
        if isinstance(item, str):
            text = item.strip()
            if text:
                out.append(text)
        elif isinstance(item, dict):
            for key in ("lang", "language", "name", "label", "title"):
                raw = item.get(key)
                if raw:
                    out.append(str(raw).strip())
                    break
    return out


def _lang_key(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (name or "").lower())


def _langs_match(languages: list[str], needles: frozenset[str]) -> bool:
    for lang in languages:
        key = _lang_key(lang)
        if key in needles:
            return True
        if any(n in key for n in needles):
            return True
    return False


def _split_formatter_langs(text: str) -> list[str]:
    return [p.strip() for p in re.split(r"\s*\|\s*", text) if p.strip()]


def _parse_formatter_description(desc: str) -> tuple[list[str], list[str]]:
    """Parse 🌎 / 📝 lines from AIOStreams custom formatter output."""
    languages: list[str] = []
    subtitles: list[str] = []
    for line in (desc or "").splitlines():
        m = _FMT_LANG_LINE.search(line)
        if m:
            languages = _split_formatter_langs(m.group(1))
            continue
        m = _FMT_SUB_LINE.search(line)
        if m:
            subtitles = _split_formatter_langs(m.group(1))
    return languages, subtitles


def _extract_aiostreams_fields(stream: dict) -> dict:
    """Read structured metadata from AIOStreams streamData / parsedFile."""
    parent = stream.get("_aiostreams_parent")
    if isinstance(parent, dict):
        roots = [parent, stream]
    else:
        roots = [stream]

    blob: dict = stream
    for root in roots:
        sd = root.get("streamData")
        if isinstance(sd, dict):
            blob = sd
            break

    pf = blob.get("parsedFile")
    if not isinstance(pf, dict):
        pf = {}

    languages = _string_list(pf.get("languages"))
    subtitles = _string_list(pf.get("subtitles"))
    if not subtitles:
        subtitles = _string_list(blob.get("subtitles"))

    desc = (
        stream.get("description")
        or (parent or {}).get("description")
        or blob.get("description")
        or ""
    )
    fmt_langs, fmt_subs = _parse_formatter_description(desc)
    if not languages and fmt_langs:
        languages = fmt_langs
    if not subtitles and fmt_subs:
        subtitles = fmt_subs

    torrent = blob.get("torrent") if isinstance(blob.get("torrent"), dict) else {}
    service = blob.get("service") if isinstance(blob.get("service"), dict) else {}

    return {
        "languages": languages,
        "subtitle_langs": subtitles,
        "audio_tags": _string_list(pf.get("audioTags")),
        "audio_channels": _string_list(pf.get("audioChannels")),
        "visual_tags": _string_list(pf.get("visualTags")),
        "release_group": (pf.get("releaseGroup") or "").strip(),
        "network": (pf.get("network") or "").strip(),
        "quality_tag": (pf.get("quality") or "").strip(),
        "encode_tag": (pf.get("encode") or "").strip(),
        "resolution_structured": (pf.get("resolution") or "").strip(),
        "dubbed": blob.get("dubbed") if isinstance(blob.get("dubbed"), bool) else None,
        "subbed": blob.get("subbed") if isinstance(blob.get("subbed"), bool) else None,
        "seeders_structured": torrent.get("seeders"),
        "size_bytes_structured": int(blob.get("size") or 0),
        "service_cached": service.get("cached"),
        "indexer": (blob.get("indexer") or "").strip(),
    }


def _lang_meta_from_structured(structured: dict) -> dict | None:
    languages = structured.get("languages") or []
    subtitles = structured.get("subtitle_langs") or []
    dubbed = structured.get("dubbed")
    subbed = structured.get("subbed")

    if not languages and dubbed is None and not subtitles:
        return None

    audio_lang = ""
    lang_tags: list[str] = []

    if dubbed is True:
        audio_lang = "dub"
    elif any("dual audio" in _lang_key(l) or l.lower() == "dual" for l in languages):  # noqa: E741
        audio_lang = "dual"
    elif any("multi" in _lang_key(l) for l in languages):  # noqa: E741
        audio_lang = "dual"
    elif _langs_match(languages, _ENGLISH_LANG) and _langs_match(languages, _JAPANESE_LANG):
        audio_lang = "dual"
    elif _langs_match(languages, _ENGLISH_LANG):
        audio_lang = "dub"
    elif _langs_match(languages, _JAPANESE_LANG):
        audio_lang = "sub"

    subtitle_type = ""
    if subtitles or subbed is True:
        subtitle_type = "softsub"

    if audio_lang == "dual":
        lang_tags.append("Dual")
    elif audio_lang == "dub":
        lang_tags.append("Dub")
    elif audio_lang == "sub":
        lang_tags.append("Sub")
    if subtitle_type == "softsub" and subtitles:
        lang_tags.append("Softsub")

    for lang in languages[:3]:
        tag = lang.strip()
        if tag and tag not in lang_tags and len(lang_tags) < 6:
            lang_tags.append(tag)

    return {
        "audio_lang": audio_lang,
        "subtitle_type": subtitle_type,
        "lang_tags": lang_tags,
        "audio_lang_rank": _AUDIO_LANG_RANK.get(audio_lang, 0),
    }


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
    has_sd_hd = any(l in labels for l in ("1080p", "720p", "480p", "1440p"))  # noqa: E741
    if has_sd_hd and "2160p" in labels:
        has_literal_4k = bool(re.search(r"\b(2160p|4k)\b", blob, re.I))
        if not has_literal_4k:
            labels = [l for l in labels if l != "2160p"]  # noqa: E741
    return max(labels, key=lambda l: _RES_RANK.get(l, 0))  # noqa: E741


def _parse_provider(name: str) -> str:
    n = name
    for tag in ("[TB⚡]", "[TB⏳]", "[TB⌛]"):
        n = n.replace(tag, "")
    n = _NAME_RES_SUFFIX.sub("", n).strip()
    return n


def _parse_language_meta(text: str) -> dict:
    """Infer dub/sub/dual and subtitle type from release name / filename."""
    has_dub = bool(_DUB_RE.search(text)) or bool(_ENG_TAG_RE.search(text))
    has_dual = bool(_DUAL_RE.search(text))
    has_sub = bool(_SUB_RE.search(text))
    has_raw = bool(_RAW_RE.search(text))
    has_jpn = bool(_JPN_RE.search(text))
    hardsub = bool(_HARDSUB_RE.search(text))
    softsub = bool(_SOFTSUB_RE.search(text))

    subtitle_type = ""
    if hardsub:
        subtitle_type = "hardsub"
    elif softsub:
        subtitle_type = "softsub"
    elif has_sub and not has_dub and not has_dual:
        subtitle_type = "softsub"

    audio_lang = ""
    if has_dual:
        audio_lang = "dual"
    elif has_dub and not (has_jpn and not has_sub):
        audio_lang = "dub"
    elif has_sub or has_raw or (has_jpn and not has_dub):
        audio_lang = "sub"
    elif has_jpn and not has_dub:
        audio_lang = "sub"

    lang_tags: list[str] = []
    if audio_lang == "dual":
        lang_tags.append("Dual")
    elif audio_lang == "dub":
        lang_tags.append("Dub")
    elif audio_lang == "sub":
        lang_tags.append("Sub")
    if subtitle_type == "hardsub":
        lang_tags.append("Hardsub")
    elif subtitle_type == "softsub" and "Hardsub" not in lang_tags:
        lang_tags.append("Softsub")

    return {
        "audio_lang": audio_lang,
        "subtitle_type": subtitle_type,
        "lang_tags": lang_tags,
        "audio_lang_rank": _AUDIO_LANG_RANK.get(audio_lang, 0),
    }


def parse_stream(stream: dict) -> dict | None:
    """Turn a raw Stremio stream object into structured, filterable metadata."""
    structured = _extract_aiostreams_fields(stream)
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
    res_struct = structured.get("resolution_structured") or ""
    if res_struct:
        res_norm = res_struct.lower().replace("4k", "2160p")
        if res_norm in _RES_RANK:
            resolution = res_norm
    hdr_m = _HDR_RE.search(text)
    if not hdr_m and structured.get("visual_tags"):
        hdr_blob = " ".join(structured["visual_tags"])
        hdr_m = _HDR_RE.search(hdr_blob)
    cached = (
        "⚡" in text
        or "✅" in text
        or "cached" in text.lower()
        or "instant" in text.lower()
        or "in library" in text.lower()
        or structured.get("service_cached") is True
    )
    seeders = _parse_seeders(text)
    try:
        if structured.get("seeders_structured") is not None:
            seeders = max(seeders, int(structured["seeders_structured"]))
    except (TypeError, ValueError):
        pass
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
    lang = _parse_language_meta(text)
    struct_lang = _lang_meta_from_structured(structured)
    if struct_lang:
        # Prefer AIOStreams parsed languages over filename regex guesses.
        if struct_lang.get("audio_lang") or struct_lang.get("subtitle_type"):
            lang = struct_lang
        elif struct_lang.get("lang_tags"):
            lang = {**lang, "lang_tags": struct_lang["lang_tags"]}

    codec = structured.get("encode_tag") or _first(_CODEC_PATTERNS, text)
    source = structured.get("quality_tag") or _first(_SOURCE_PATTERNS, text)
    struct_size = structured.get("size_bytes_structured") or 0
    if struct_size > 0:
        size_bytes = struct_size

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
        "codec": codec,
        "source": source,
        "hdr": hdr_m.group(0).upper() if hdr_m else "",
        "size_gb": _size_gb(text, size_bytes),
        "size_bytes": size_bytes,
        "seeders": seeders,
        "cached": cached,
        "playable": playable,
        "cacheable": cacheable,
        "playback_cacheable": playback_cacheable,
        "languages": structured.get("languages") or [],
        "subtitle_langs": structured.get("subtitle_langs") or [],
        "audio_tags": structured.get("audio_tags") or [],
        "visual_tags": structured.get("visual_tags") or [],
        "release_group": structured.get("release_group") or "",
        "network": structured.get("network") or "",
        "indexer": structured.get("indexer") or "",
        **lang,
    }


def parse_streams(streams: list[dict]) -> list[dict]:
    out = []
    for raw in streams:
        norm = _normalize_raw_stream(raw)
        if norm and (p := parse_stream(norm)):
            out.append(p)
    out.sort(key=lambda x: (x["resolution_rank"], x["cached"], x["seeders"]), reverse=True)
    return out
