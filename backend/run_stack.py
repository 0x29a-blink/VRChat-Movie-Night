"""
Movie Night — one console, three services:
  MediaMTX (HLS :8888) + optional AIOStreams (:3000) + API (:8000)

Child logs are prefixed in this window. Ctrl+C or closing this window stops all services.
Use stop-stack.cmd from the project root if anything is left running.
"""

from __future__ import annotations

import atexit
import shutil
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path

from stack_manager import (
    PROJECT_ROOT,
    cleanup_before_start,
    install_console_shutdown_handler,
    popen_service,
    shutdown_all,
)

BACKEND_DIR = Path(__file__).resolve().parent
MEDIAMTX_DIR = PROJECT_ROOT / "MediaMTX"
AIOSTREAMS_DIR = PROJECT_ROOT / "AIOStreams"
AIOSTREAMS_REPO = AIOSTREAMS_DIR / "repo"
AIOSTREAMS_ENTRY = AIOSTREAMS_REPO / "packages" / "server" / "dist" / "server.js"
VENV_PYTHON = BACKEND_DIR / ".venv" / "Scripts" / "python.exe"


def _relay_output(proc: subprocess.Popen, name: str) -> None:
    if proc.stdout is None:
        return
    for raw in proc.stdout:
        line = raw.decode("utf-8", errors="replace") if isinstance(raw, bytes) else raw
        sys.stdout.write(f"[{name}] {line}")
        if not line.endswith("\n"):
            sys.stdout.write("\n")
        sys.stdout.flush()


def _ensure_backend_ready() -> Path:
    python = VENV_PYTHON if VENV_PYTHON.is_file() else Path(sys.executable)
    if not VENV_PYTHON.is_file():
        print("[setup] Creating Python virtual environment...")
        subprocess.check_call([sys.executable, "-m", "venv", str(BACKEND_DIR / ".venv")], cwd=BACKEND_DIR)
        subprocess.check_call([str(VENV_PYTHON), "-m", "pip", "install", "--upgrade", "pip"], cwd=BACKEND_DIR)
        subprocess.check_call([str(VENV_PYTHON), "-m", "pip", "install", "-r", "requirements.txt"], cwd=BACKEND_DIR)
        python = VENV_PYTHON
    env_file = BACKEND_DIR / ".env"
    if not env_file.is_file():
        example = BACKEND_DIR / ".env.example"
        if example.is_file():
            shutil.copy(example, env_file)
            print("[setup] Created backend/.env from .env.example — edit secrets before LAN use.")
    if not (PROJECT_ROOT / "frontend" / "dist" / "index.html").is_file():
        print("[warn] Frontend not built — run:  build-frontend.cmd")
    return python


def _find_mediamtx() -> Path | None:
    bundled = MEDIAMTX_DIR / "mediamtx.exe"
    if bundled.is_file():
        return bundled
    found = shutil.which("mediamtx")
    return Path(found) if found else None


def _sync_aiostreams_env() -> None:
    src = AIOSTREAMS_DIR / ".env"
    dst = AIOSTREAMS_REPO / ".env"
    if src.is_file() and AIOSTREAMS_REPO.is_dir():
        shutil.copy(src, dst)


def _start_mediamtx() -> bool:
    exe = _find_mediamtx()
    cfg = MEDIAMTX_DIR / "mediamtx.yml"
    if not exe:
        print("[stack] MediaMTX not found — place mediamtx.exe in MediaMTX\\ or install on PATH.")
        return False
    if not cfg.is_file():
        print(f"[stack] Missing {cfg}")
        return False
    print(f"[stack] MediaMTX  RTMP :1935  HLS http://localhost:8888/live/vrstream/")
    proc = popen_service("MediaMTX", [str(exe), "mediamtx.yml"], cwd=MEDIAMTX_DIR)
    threading.Thread(target=_relay_output, args=(proc, "MediaMTX"), daemon=True).start()
    return True


def _start_aiostreams() -> bool:
    if not AIOSTREAMS_ENTRY.is_file():
        print("[stack] AIOStreams not built — optional; run AIOStreams\\setup-aiostreams.cmd")
        return False
    env_file = AIOSTREAMS_DIR / ".env"
    if not env_file.is_file():
        print("[stack] AIOStreams .env missing — run AIOStreams\\setup-aiostreams.cmd")
        return False
    _sync_aiostreams_env()
    node = shutil.which("node")
    if not node:
        print("[stack] node not on PATH — cannot start AIOStreams")
        return False
    print("[stack] AIOStreams  http://localhost:3000/stremio/configure")
    rel = "packages/server/dist/server.js"
    proc = popen_service("AIOStreams", [node, rel], cwd=AIOSTREAMS_REPO)
    threading.Thread(target=_relay_output, args=(proc, "AIOStreams"), daemon=True).start()
    return True


def _print_banner() -> None:
    print()
    print("  ============================================================")
    print("   Movie Night stack")
    print("  ============================================================")
    print("   Web app     http://localhost:8000")
    print("   MediaMTX    HLS on port 8888 (OBS -> rtmp://localhost:1935/live)")
    print("   AIOStreams  http://localhost:3000 (optional torrent search)")
    print()
    print("   Stop: Ctrl+C here, or close this window, or run stop-stack.cmd")
    print("  ============================================================")
    print()


def main() -> int:
    install_console_shutdown_handler()
    atexit.register(shutdown_all)
    signal.signal(signal.SIGINT, lambda *_: (shutdown_all(), sys.exit(0)))
    if sys.platform == "win32":
        signal.signal(signal.SIGBREAK, lambda *_: (shutdown_all(), sys.exit(0)))

    cleanup_before_start()
    python = _ensure_backend_ready()
    _print_banner()

    _start_mediamtx()
    _start_aiostreams()
    time.sleep(1.5)

    print("[API] http://localhost:8000")
    print()
    try:
        return subprocess.call(
            [str(python), "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"],
            cwd=BACKEND_DIR,
        )
    finally:
        shutdown_all()


if __name__ == "__main__":
    raise SystemExit(main())
