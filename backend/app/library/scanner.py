import hashlib
import json
import re
import subprocess
from concurrent.futures import ThreadPoolExecutor
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
        new_files: list[Path] = []
        new_file_meta: dict[Path, tuple[str, int]] = {}  # file -> (key, size)
        stale_existing: list[tuple[Path, "LibraryItem"]] = []  # existing rows needing a probe

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
                new_files.append(file)
                new_file_meta[file] = (key, size)
            else:
                if item.size != size:
                    item.size = size
                if not item.duration or not item.thumbnail:
                    stale_existing.append((file, item))

        # Probe duration for new files and any existing rows still missing a
        # duration, in parallel, outside the DB session, using a bounded pool.
        duration_targets = list(new_files) + [f for f, item in stale_existing if not item.duration]
        durations: dict[Path, float] = {}
        if duration_targets:
            with ThreadPoolExecutor(max_workers=4) as pool:
                durations = dict(zip(duration_targets, pool.map(_probe_duration, duration_targets)))

        # Thumbnails use the (possibly just-probed) duration per file, matching
        # the original serial code's ordering (duration is set before the thumb
        # is generated for the same file).
        def _duration_for(file: Path, item=None) -> float:
            if file in durations:
                return durations[file]
            return item.duration if item is not None else 0.0

        thumb_targets: list[Path] = []
        thumb_durations: dict[Path, float] = {}
        for file in new_files:
            thumb_targets.append(file)
            thumb_durations[file] = _duration_for(file)
        for file, item in stale_existing:
            if not item.thumbnail:
                thumb_targets.append(file)
                thumb_durations[file] = _duration_for(file, item)

        thumbs: dict[Path, str] = {}
        if thumb_targets:
            with ThreadPoolExecutor(max_workers=4) as pool:
                thumbs = dict(
                    zip(thumb_targets, pool.map(lambda f: _make_thumb(f, thumb_durations[f]), thumb_targets))
                )

        for file in new_files:
            key, size = new_file_meta[file]
            s.add(
                LibraryItem(
                    path=key,
                    filename=file.name,
                    title=file.stem,
                    folder=folder_key,
                    size=size,
                    duration=durations.get(file, 0.0),
                    thumbnail=thumbs.get(file, ""),
                )
            )

        for file, item in stale_existing:
            if not item.duration:
                item.duration = durations.get(file, 0.0)
            if not item.thumbnail:
                item.thumbnail = thumbs.get(file, "")

        # Remove DB entries for deleted files
        for path, item in existing.items():
            if path not in seen:
                s.delete(item)
        s.commit()


def scan_all() -> None:
    for kind in ("youtube", "m3u8", "torrent"):
        scan_folder(kind)
