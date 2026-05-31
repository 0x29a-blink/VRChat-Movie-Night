import hashlib
import json
import re
import subprocess
from pathlib import Path

from ..config import settings
from ..db import SessionLocal
from ..models import LibraryItem

VIDEO_EXTS = {".mp4", ".mkv", ".webm", ".mov", ".ts", ".m4v", ".avi"}
# yt-dlp leaves per-format fragments like "Title.f137.mp4" before merging.
FRAGMENT_RE = re.compile(r"\.f\d+$")

_FOLDERS = {
    "youtube": settings.folder_for("youtube"),
    "m3u8": settings.folder_for("m3u8"),
    "torrents": settings.folder_for("torrent"),
}

CREATE_NO_WINDOW = 0x08000000


def _run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        creationflags=CREATE_NO_WINDOW,
    )


def _probe_duration(path: Path) -> float:
    try:
        res = _run(
            [
                settings.ffprobe_path,
                "-v",
                "quiet",
                "-print_format",
                "json",
                "-show_format",
                str(path),
            ]
        )
        data = json.loads(res.stdout or "{}")
        return float(data.get("format", {}).get("duration", 0) or 0)
    except Exception:
        return 0.0


def _make_thumb(path: Path, duration: float) -> str:
    digest = hashlib.sha1(str(path).encode("utf-8")).hexdigest()[:16]
    out = settings.thumbnails_path / f"{digest}.jpg"
    if out.exists():
        return out.name
    ts = max(1, min(duration * 0.2, 120)) if duration else 5
    try:
        _run(
            [
                settings.ffmpeg_path,
                "-y",
                "-ss",
                str(int(ts)),
                "-i",
                str(path),
                "-frames:v",
                "1",
                "-vf",
                "scale=480:-1",
                str(out),
            ]
        )
        return out.name if out.exists() else ""
    except Exception:
        return ""


def scan_folder(kind: str) -> None:
    """kind is youtube | m3u8 | torrent (maps to torrents folder)."""
    folder_key = "torrents" if kind == "torrent" else kind
    folder = _FOLDERS.get(folder_key)
    if folder is None:
        return
    folder.mkdir(parents=True, exist_ok=True)

    with SessionLocal() as s:
        existing = {item.path: item for item in s.query(LibraryItem).filter_by(folder=folder_key).all()}
        seen: set[str] = set()
        for file in folder.iterdir():
            if not file.is_file() or file.suffix.lower() not in VIDEO_EXTS:
                continue
            if FRAGMENT_RE.search(file.stem):
                continue
            key = str(file.resolve())
            seen.add(key)
            size = file.stat().st_size
            item = existing.get(key)
            if item is None:
                duration = _probe_duration(file)
                thumb = _make_thumb(file, duration)
                s.add(
                    LibraryItem(
                        path=key,
                        filename=file.name,
                        title=file.stem,
                        folder=folder_key,
                        size=size,
                        duration=duration,
                        thumbnail=thumb,
                    )
                )
            else:
                if item.size != size:
                    item.size = size
                if not item.duration:
                    item.duration = _probe_duration(file)
                if not item.thumbnail:
                    item.thumbnail = _make_thumb(file, item.duration)
        # Remove DB entries for deleted files
        for path, item in existing.items():
            if path not in seen:
                s.delete(item)
        s.commit()


def scan_all() -> None:
    for kind in ("youtube", "m3u8", "torrent"):
        scan_folder(kind)
