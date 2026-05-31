"""Extract playable video from torrent .iso files (data disc, not always DVD-Video)."""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from .. import settings_store
from ..config import settings

VIDEO_SUFFIXES = (".mkv", ".mp4", ".m4v", ".avi", ".mov", ".webm", ".ts", ".m2ts", ".mpg", ".mpeg")

# Common in repacked game ISOs (e.g. TiNYiSO)
_GAME_PATH_MARKERS = (
    "setup.exe",
    "autorun.inf",
    "steam_api.dll",
    "tinyiso.bin",
    "_data/",
    "gog.exe",
    "reloaded.dll",
    "codex.dll",
    "flt.ini",
)


def _ffprobe_path() -> str:
    ff = settings.ffmpeg_path
    if "ffmpeg" in ff.lower():
        return ff.replace("ffmpeg", "ffprobe").replace("FFMPEG", "ffprobe")
    return "ffprobe"


def _unique_mkv_dst(src: Path) -> Path:
    dst = src.with_suffix(".mkv")
    i = 1
    while dst.exists():
        dst = src.parent / f"{src.stem} ({i}).mkv"
        i += 1
    return dst


def _ffmpeg_maps(preserve: bool) -> list[str]:
    if preserve:
        return ["-map", "0:v:0?", "-map", "0:a?", "-map", "0:s?", "-dn"]
    return ["-map", "0:v:0?", "-map", "0:a:0?", "-sn", "-dn"]


def _iso_has_video_streams(iso: Path) -> bool:
    try:
        proc = subprocess.run(
            [
                _ffprobe_path(),
                "-v",
                "error",
                "-select_streams",
                "v",
                "-show_entries",
                "stream=codec_type",
                "-of",
                "csv=p=0",
                str(iso),
            ],
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False
    return proc.returncode == 0 and "video" in (proc.stdout or "")


def _remux_to_mkv(src: Path, dst: Path) -> tuple[int, str]:
    preserve = bool(settings_store.get("preserve_torrent_tracks", True))
    cmd = [
        settings.ffmpeg_path,
        "-hide_banner",
        "-y",
        "-i",
        str(src),
        *_ffmpeg_maps(preserve),
        "-c",
        "copy",
        "-ignore_unknown",
        "-fflags",
        "+genpts",
        "-max_muxing_queue_size",
        "1024",
        str(dst),
    ]
    try:
        proc = subprocess.run(
            cmd, capture_output=True, text=True, timeout=7200, check=False
        )
    except FileNotFoundError as exc:
        return 1, f"ffmpeg not found: {exc}"
    except subprocess.TimeoutExpired:
        return 1, "ffmpeg timed out"
    if proc.returncode == 0 and dst.is_file() and dst.stat().st_size > 0:
        return 0, ""
    tail = (proc.stderr or proc.stdout or "").strip().splitlines()[-4:]
    return 1, "\n".join(tail) if tail else f"ffmpeg exited {proc.returncode}"


def _pick_largest_video(paths: list[Path]) -> Path | None:
    candidates = [p for p in paths if p.suffix.lower() in VIDEO_SUFFIXES and p.is_file()]
    if not candidates:
        return None
    return max(candidates, key=lambda p: p.stat().st_size)


def _collect_videos_under(root: Path) -> list[Path]:
    out: list[Path] = []
    for dirpath, _, filenames in os.walk(root):
        for name in filenames:
            p = Path(dirpath) / name
            if p.suffix.lower() in VIDEO_SUFFIXES:
                out.append(p)
    return out


def _relative_paths_under(root: Path) -> list[str]:
    rel: list[str] = []
    for dirpath, _, filenames in os.walk(root):
        for name in filenames:
            rel.append(str(Path(dirpath, name).relative_to(root)).replace("\\", "/"))
    return rel


def _looks_like_game_installer(rel_paths: list[str]) -> bool:
    joined = " ".join(rel_paths).lower()
    if "setup.exe" not in joined:
        return False
    return any(m in joined for m in _GAME_PATH_MARKERS if m != "setup.exe")


def _find_7z_exe() -> str | None:
    for name in ("7z", "7z.exe"):
        found = shutil.which(name)
        if found:
            return found
    for p in (
        Path(r"C:\Program Files\7-Zip\7z.exe"),
        Path(r"C:\Program Files (x86)\7-Zip\7z.exe"),
    ):
        if p.is_file():
            return str(p)
    return None


def _extract_with_7z(iso: Path, work: Path) -> list[Path]:
    exe = _find_7z_exe()
    if not exe:
        return []
    proc = subprocess.run(
        [exe, "x", f"-o{work}", "-y", str(iso)],
        capture_output=True,
        text=True,
        timeout=7200,
        check=False,
    )
    if proc.returncode != 0:
        return []
    return _collect_videos_under(work)


def _mount_iso_windows(iso: Path) -> str | None:
    """Return mount root like G:\\ or None."""
    iso_esc = str(iso).replace("'", "''")
    ps = (
        f"$m = Mount-DiskImage -ImagePath '{iso_esc}' -PassThru; "
        "Start-Sleep -Seconds 2; "
        "($m | Get-Volume | Where-Object { $_.DriveLetter }).DriveLetter"
    )
    try:
        proc = subprocess.run(
            ["powershell", "-NoProfile", "-Command", ps],
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None
    letter = (proc.stdout or "").strip()
    if not letter or len(letter) != 1:
        return None
    return f"{letter}:\\"


def _dismount_iso_windows(iso: Path) -> None:
    iso_esc = str(iso).replace("'", "''")
    subprocess.run(
        [
            "powershell",
            "-NoProfile",
            "-Command",
            f"Dismount-DiskImage -ImagePath '{iso_esc}'",
        ],
        capture_output=True,
        timeout=60,
        check=False,
    )


def _extract_from_mount(iso: Path, dst: Path) -> tuple[int, str, str] | None:
    """Extract while ISO is mounted. None = could not mount."""
    root = _mount_iso_windows(iso)
    if not root:
        return None
    mount = Path(root)
    try:
        rel = _relative_paths_under(mount)
        if _looks_like_game_installer(rel):
            return 1, "", _game_installer_message()
        best = _pick_largest_video(_collect_videos_under(mount))
        if not best:
            return None
        return _finalize_video(best, dst)
    finally:
        _dismount_iso_windows(iso)


def _finalize_video(video: Path, dst: Path) -> tuple[int, str, str]:
    if video.suffix.lower() == ".mkv" and not bool(
        settings_store.get("preserve_torrent_tracks", True)
    ):
        try:
            shutil.move(str(video), str(dst))
            return 0, str(dst), ""
        except OSError as exc:
            return 1, "", f"Could not move video: {exc}"
    rc, err = _remux_to_mkv(video, dst)
    if rc == 0:
        return 0, str(dst), ""
    return 1, "", err


def _game_installer_message() -> str:
    return (
        "This .iso is a PC game or software installer (e.g. setup.exe), not a movie file. "
        "Pick a cached stream whose filename ends in .mkv or .mp4, or search for a video release."
    )


def extract_disc_image(iso: Path) -> tuple[int, str, str]:
    """Return (rc, output_mkv_path, error_message)."""
    if not iso.is_file():
        return 1, "", "Disc image file is missing"

    dst = _unique_mkv_dst(iso)

    if _iso_has_video_streams(iso):
        rc, err = _remux_to_mkv(iso, dst)
        if rc == 0:
            return 0, str(dst), ""

    with tempfile.TemporaryDirectory(prefix="iso_extract_") as tmp:
        work = Path(tmp)
        videos = _extract_with_7z(iso, work)
        if videos:
            rel = [str(v.relative_to(work)).replace("\\", "/") for v in videos]
            if _looks_like_game_installer(rel):
                return 1, "", _game_installer_message()
            best = _pick_largest_video(videos)
            if best:
                return _finalize_video(best, dst)

    if sys.platform == "win32":
        mounted = _extract_from_mount(iso, dst)
        if mounted is not None:
            return mounted

    hint = ""
    if not _find_7z_exe():
        hint = " Install 7-Zip for data-disc extraction, or"
    return (
        1,
        "",
        "Could not find playable video inside this .iso."
        f"{hint} choose a stream whose filename ends in .mkv or .mp4.",
    )
