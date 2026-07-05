"""Resolve library files for OBS playback (audio/subtitle track selection via remux)."""

from __future__ import annotations

import hashlib
import json
import logging
import subprocess
from pathlib import Path

from ..config import settings
from ..models import LibraryItem

logger = logging.getLogger(__name__)

CREATE_NO_WINDOW = 0x08000000


def _run(cmd: list[str], timeout: int = 600) -> subprocess.CompletedProcess:
    if cmd and cmd[0] and "ffmpeg" in cmd[0].lower() and "-nostdin" not in cmd:
        # Insert after ffmpeg binary — prevents Windows subprocess hangs.
        cmd = [cmd[0], "-nostdin", *cmd[1:]]
    return subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=timeout,
        creationflags=CREATE_NO_WINDOW,
    )


def probe_media_tracks(path: Path) -> dict:
    """Return audio and subtitle streams for a local video file."""
    # FFmpeg 8+ rejects "-select_streams a,s" (invalid specifier). Probe all streams and filter.
    res = _run(
        [
            settings.ffprobe_path,
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_streams",
            str(path),
        ],
        timeout=60,
    )
    err_text = (res.stderr or "").strip()
    if res.returncode != 0 and not (res.stdout or "").strip():
        hint = err_text or "ffprobe failed"
        if "not found" in hint.lower() or isinstance(res.returncode, int) and res.returncode == 127:
            hint = f"{hint} — set FFPROBE_PATH in backend/.env (e.g. full path to ffprobe.exe)"
        return {"audio": [], "subtitles": [], "error": hint}

    try:
        data = json.loads(res.stdout or "{}")
    except json.JSONDecodeError as exc:
        return {"audio": [], "subtitles": [], "error": err_text or str(exc)}
    audio: list[dict] = []
    subtitles: list[dict] = []
    for stream in data.get("streams") or []:
        kind = stream.get("codec_type")
        tags = stream.get("tags") or {}
        lang = (tags.get("language") or tags.get("LANGUAGE") or "").strip()
        title = (tags.get("title") or tags.get("TITLE") or "").strip()
        codec = (stream.get("codec_name") or "").strip()
        entry = {
            "index": int(stream.get("index", 0)),
            "codec": codec,
            "language": lang,
            "title": title,
            "label": _stream_label(kind, len(audio) if kind == "audio" else len(subtitles), lang, title, codec),
        }
        if kind == "audio":
            entry["audio_index"] = len(audio)
            audio.append(entry)
        elif kind == "subtitle":
            entry["subtitle_index"] = len(subtitles)
            subtitles.append(entry)

    return {"audio": audio, "subtitles": subtitles, "error": ""}


def _stream_label(kind: str, ordinal: int, lang: str, title: str, codec: str) -> str:
    parts = [f"{'Audio' if kind == 'audio' else 'Subtitle'} {ordinal}"]
    if lang:
        parts.append(f"({lang})")
    if title:
        parts.append(f"— {title}")
    elif codec:
        parts.append(f"— {codec.upper()}")
    return " ".join(parts)


def _cache_path(source: Path, item: LibraryItem) -> Path:
    try:
        mtime = int(source.stat().st_mtime)
    except OSError:
        mtime = 0
    audio = item.playback_audio_index if item.playback_audio_index is not None else -1
    sub = item.playback_subtitle_index if item.playback_subtitle_index is not None else -1
    burn = 1 if item.playback_burn_subtitles else 0
    key = f"{source.resolve()}|{mtime}|a{audio}|s{sub}|b{burn}"
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()[:20]
    cache_dir = Path(settings.data_dir) / "play_cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    return cache_dir / f"{digest}.mkv"


def _needs_remux(item: LibraryItem, tracks: dict) -> bool:
    audio_count = len(tracks.get("audio") or [])
    if audio_count <= 1 and (item.playback_subtitle_index is None or item.playback_subtitle_index < 0):
        return False
    if item.playback_audio_index is not None and item.playback_audio_index > 0:
        return True
    if item.playback_subtitle_index is not None and item.playback_subtitle_index >= 0:
        return True
    return False


def build_playback_file(item: LibraryItem) -> str:
    """Return path OBS should open (original file or remuxed cache)."""
    source = Path(item.path)
    if not source.is_file():
        raise FileNotFoundError(f"File not found: {source}")

    tracks = probe_media_tracks(source)
    if tracks.get("error"):
        logger.warning("ffprobe failed for %s: %s", source, tracks["error"])
        return str(source)

    if not _needs_remux(item, tracks):
        return str(source.resolve())

    cache = _cache_path(source, item)
    if cache.is_file() and cache.stat().st_size > 0:
        return str(cache.resolve())

    audio_list = tracks["audio"]
    audio_idx = item.playback_audio_index if item.playback_audio_index is not None else 0
    if audio_idx < 0 or audio_idx >= len(audio_list):
        audio_idx = 0

    sub_idx = item.playback_subtitle_index
    burn = bool(item.playback_burn_subtitles)
    sub_list = tracks["subtitles"]

    cache.parent.mkdir(parents=True, exist_ok=True)
    if sub_idx is not None and sub_idx >= 0 and sub_idx < len(sub_list) and burn:
        sub_codec = sub_list[sub_idx].get("codec") or ""
        _remux_burn_subtitles(source, cache, audio_idx, sub_idx, sub_codec)
    else:
        _remux_copy(source, cache, audio_idx)

    return str(cache.resolve())


def _remux_copy(source: Path, dest: Path, audio_ordinal: int) -> None:
    cmd = [
        settings.ffmpeg_path,
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(source),
        "-map",
        "0:v:0?",
        "-map",
        f"0:a:{audio_ordinal}?",
        "-sn",
        "-dn",
        "-c",
        "copy",
        "-max_muxing_queue_size",
        "1024",
        str(dest),
    ]
    res = _run(cmd)
    if res.returncode != 0 or not dest.is_file():
        raise RuntimeError(res.stderr.strip() or "ffmpeg remux failed")


def _remux_burn_subtitles(
    source: Path,
    dest: Path,
    audio_ordinal: int,
    subtitle_ordinal: int,
    subtitle_codec: str = "",
) -> None:
    codec = (subtitle_codec or "").lower()
    bitmap = codec in ("hdmv_pgs_subtitle", "dvd_subtitle", "dvb_subtitle", "dvdsub")

    if bitmap:
        # Bitmap subs (PGS/VOBSUB): overlay the subtitle stream onto video.
        cmd = [
            settings.ffmpeg_path,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(source),
            "-filter_complex",
            f"[0:v][0:s:{subtitle_ordinal}]overlay[vout]",
            "-map",
            "[vout]",
            "-map",
            f"0:a:{audio_ordinal}?",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "18",
            "-c:a",
            "copy",
            "-sn",
            "-dn",
            "-max_muxing_queue_size",
            "1024",
            str(dest),
        ]
    else:
        # Text-based subs (SRT/ASS): subtitles filter with stream index.
        sub_path = str(source.resolve()).replace("\\", "/")
        if len(sub_path) >= 2 and sub_path[1] == ":":
            sub_path = sub_path[0] + "\\:" + sub_path[2:]
        sub_path = sub_path.replace("'", "'\\''")
        vf = f"subtitles='{sub_path}':si={subtitle_ordinal}"
        cmd = [
            settings.ffmpeg_path,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(source),
            "-map",
            "0:v:0?",
            "-map",
            f"0:a:{audio_ordinal}?",
            "-vf",
            vf,
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "18",
            "-c:a",
            "copy",
            "-sn",
            "-dn",
            "-max_muxing_queue_size",
            "1024",
            str(dest),
        ]
    res = _run(cmd, timeout=3600)
    if res.returncode != 0 or not dest.is_file():
        detail = (res.stderr or res.stdout or "").strip()
        raise RuntimeError(detail or "ffmpeg subtitle burn-in failed")
