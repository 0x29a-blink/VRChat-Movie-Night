"""Resolve ffmpeg / yt-dlp / ffprobe: bundled tools/ dir first, then PATH."""

from __future__ import annotations

from pathlib import Path

from .config import PROJECT_ROOT

TOOLS_DIR = PROJECT_ROOT / "tools"

# Default .env values that mean "not explicitly configured"
_PATH_DEFAULTS = {
    "ytdlp_path": frozenset({"yt-dlp", "yt-dlp.exe"}),
    "ffmpeg_path": frozenset({"ffmpeg", "ffmpeg.exe"}),
    "ffprobe_path": frozenset({"ffprobe", "ffprobe.exe"}),
}


def _bundled_candidates(stem: str) -> list[Path]:
    return [TOOLS_DIR / f"{stem}.exe", TOOLS_DIR / stem]


def find_bundled(stem: str) -> Path | None:
    for path in _bundled_candidates(stem):
        if path.is_file():
            return path
    return None


def resolve_tool_path(configured: str, stem: str) -> str:
    """Pick explicit path, bundled binary, or leave configured for PATH lookup."""
    cfg = (configured or "").strip()
    if cfg:
        explicit = Path(cfg)
        if explicit.is_file():
            return str(explicit.resolve())
        if explicit.suffix.lower() == ".exe" and not explicit.is_file():
            bundled = find_bundled(explicit.stem)
            if bundled:
                return str(bundled.resolve())
    bundled = find_bundled(stem)
    if bundled:
        return str(bundled.resolve())
    return cfg or stem


def apply_bundled_tool_defaults(settings_obj) -> None:
    """Mutate Settings paths when user left factory defaults and tools/ has binaries."""
    stems = {
        "ytdlp_path": "yt-dlp",
        "ffmpeg_path": "ffmpeg",
        "ffprobe_path": "ffprobe",
    }
    for field, defaults in _PATH_DEFAULTS.items():
        current = getattr(settings_obj, field, "")
        if current not in defaults:
            continue
        resolved = resolve_tool_path(current, stems[field])
        if resolved != current:
            setattr(settings_obj, field, resolved)


def bundled_tools_status() -> list[dict[str, str | bool]]:
    """Status rows for startup / preflight (no subprocess)."""
    rows = []
    for label, stem in (
        ("yt-dlp", "yt-dlp"),
        ("ffmpeg", "ffmpeg"),
        ("ffprobe", "ffprobe"),
    ):
        path = find_bundled(stem)
        rows.append(
            {
                "name": label,
                "bundled": path is not None,
                "path": str(path) if path else str(TOOLS_DIR / f"{stem}.exe"),
            }
        )
    mediamtx = PROJECT_ROOT / "MediaMTX" / "mediamtx.exe"
    rows.append(
        {
            "name": "mediamtx",
            "bundled": mediamtx.is_file(),
            "path": str(mediamtx),
        }
    )
    return rows
