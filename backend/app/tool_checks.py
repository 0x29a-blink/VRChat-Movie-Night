import asyncio
import shutil
from dataclasses import dataclass

from .config import settings


@dataclass
class ToolStatus:
    name: str
    ok: bool
    detail: str = ""


async def _check_tool(name: str, cmd: list[str]) -> ToolStatus:
    executable = cmd[0]
    if not shutil.which(executable):
        return ToolStatus(name=name, ok=False, detail=f"{executable} not found on PATH")

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        await asyncio.wait_for(proc.wait(), timeout=8.0)
        if proc.returncode == 0:
            return ToolStatus(name=name, ok=True, detail="Available")
        return ToolStatus(name=name, ok=False, detail=f"Exit code {proc.returncode}")
    except asyncio.TimeoutError:
        return ToolStatus(name=name, ok=False, detail="Timed out")
    except OSError as exc:
        return ToolStatus(name=name, ok=False, detail=str(exc) or "Failed to run")


async def check_all_tools() -> list[dict[str, str | bool]]:
    specs: list[tuple[str, list[str]]] = [
        ("yt-dlp", [settings.ytdlp_path, "--version"]),
        ("ffmpeg", [settings.ffmpeg_path, "-version"]),
        ("ffprobe", [settings.ffprobe_path, "-version"]),
    ]
    if settings.use_deno:
        specs.append(("deno", ["deno", "--version"]))

    results = await asyncio.gather(*[_check_tool(name, cmd) for name, cmd in specs])
    return [{"name": r.name, "ok": r.ok, "detail": r.detail} for r in results]
