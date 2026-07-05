"""Upload estimation for encoder preset recommendations."""

from __future__ import annotations

import asyncio
import json
import logging
import shutil
from typing import Any

from .obs.stream_presets import recommend_from_upload_kbps

logger = logging.getLogger(__name__)

CREATE_NO_WINDOW = 0x08000000


async def run_speedtest_cli() -> dict[str, Any]:
    """
    Run Ookla speedtest CLI on the host PC (measures this machine's upload to the internet).
    Install: pip install speedtest-cli  OR  scoop install speedtest
    """
    exe = shutil.which("speedtest") or shutil.which("speedtest-cli")
    if not exe:
        return {
            "ok": False,
            "error": "speedtest CLI not found. Install speedtest-cli or use the browser upload test.",
        }

    try:
        proc = await asyncio.create_subprocess_exec(
            exe,
            "--simple",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            creationflags=CREATE_NO_WINDOW if hasattr(asyncio.subprocess, "CREATE_NO_WINDOW") else 0,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=120.0)
    except asyncio.TimeoutError:
        return {"ok": False, "error": "Speed test timed out"}
    except OSError as exc:
        return {"ok": False, "error": str(exc)}

    text = (stdout or b"").decode("utf-8", errors="replace")
    if proc.returncode != 0:
        return {"ok": False, "error": text.strip() or f"speedtest exit {proc.returncode}"}

    upload_mbps = None
    for line in text.splitlines():
        line = line.strip()
        if line.lower().startswith("upload:"):
            parts = line.split(":", 1)[1].strip().split()
            if parts:
                try:
                    val = float(parts[0])
                    unit = (parts[1] if len(parts) > 1 else "Mbit/s").lower()
                    if "kbit" in unit:
                        upload_mbps = val / 1000.0
                    elif "gbit" in unit:
                        upload_mbps = val * 1000.0
                    else:
                        upload_mbps = val
                except ValueError:
                    pass

    if upload_mbps is None:
        return {"ok": False, "error": f"Could not parse speedtest output:\n{text}"}

    upload_kbps = upload_mbps * 1000.0
    return {
        "ok": True,
        "method": "speedtest_cli",
        "upload_mbps": round(upload_mbps, 2),
        "upload_kbps": round(upload_kbps),
        "raw": text.strip(),
        **recommend_from_upload_kbps(upload_kbps),
    }


async def run_speedtest_json() -> dict[str, Any]:
    """Prefer JSON output when speedtest supports --format=json."""
    exe = shutil.which("speedtest") or shutil.which("speedtest-cli")
    if not exe:
        return {"ok": False, "error": "speedtest CLI not found"}

    try:
        proc = await asyncio.create_subprocess_exec(
            exe,
            "--format=json",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            creationflags=CREATE_NO_WINDOW if hasattr(asyncio.subprocess, "CREATE_NO_WINDOW") else 0,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=120.0)
    except Exception:
        return await run_speedtest_cli()

    if proc.returncode != 0:
        return await run_speedtest_cli()

    try:
        data = json.loads(stdout.decode("utf-8"))
        up = data.get("upload", 0) / 1_000_000.0  # bits/s to Mbps approx
        if up <= 0:
            return await run_speedtest_cli()
        upload_kbps = up * 1000.0
        return {
            "ok": True,
            "method": "speedtest_json",
            "upload_mbps": round(up, 2),
            "upload_kbps": round(upload_kbps),
            **recommend_from_upload_kbps(upload_kbps),
        }
    except (json.JSONDecodeError, KeyError, TypeError):
        return await run_speedtest_cli()


def measure_upload_from_bytes(byte_count: int, elapsed_sec: float) -> dict[str, Any]:
    if elapsed_sec <= 0:
        return {"ok": False, "error": "No data received"}
    upload_kbps = (byte_count * 8) / elapsed_sec / 1000.0
    return {
        "ok": True,
        "method": "browser_upload",
        "bytes": byte_count,
        "elapsed_sec": round(elapsed_sec, 2),
        "upload_mbps": round(upload_kbps / 1000.0, 2),
        "upload_kbps": round(upload_kbps),
        **recommend_from_upload_kbps(upload_kbps),
    }
