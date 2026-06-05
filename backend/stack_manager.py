"""Track and tear down Movie Night stack child processes (Windows-safe)."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[1]
STACK_DIR = PROJECT_ROOT / ".stack"
STATE_FILE = STACK_DIR / "state.json"

CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)

_children: list[subprocess.Popen] = []


def _read_state() -> dict[str, Any] | None:
    if not STATE_FILE.is_file():
        return None
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def _write_state(processes: list[dict[str, Any]]) -> None:
    STACK_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": 1,
        "started_at": time.time(),
        "processes": processes,
    }
    STATE_FILE.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _clear_state() -> None:
    try:
        STATE_FILE.unlink(missing_ok=True)
    except OSError:
        pass


def _pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if sys.platform == "win32":
        r = subprocess.run(
            ["tasklist", "/FI", f"PID eq {pid}", "/NH"],
            capture_output=True,
            text=True,
            creationflags=CREATE_NO_WINDOW,
        )
        out = (r.stdout or "").strip()
        return str(pid) in out and "No tasks" not in out
    try:
        import os

        os.kill(pid, 0)
        return True
    except OSError:
        return False


def kill_pid_tree(pid: int, *, name: str = "") -> bool:
    if pid <= 0:
        return False
    label = f" ({name})" if name else ""
    if sys.platform == "win32":
        r = subprocess.run(
            ["taskkill", "/PID", str(pid), "/T", "/F"],
            capture_output=True,
            text=True,
            creationflags=CREATE_NO_WINDOW,
        )
        ok = r.returncode == 0
        if ok:
            print(f"[stop] Ended PID {pid}{label}")
        return ok
    try:
        import os
        import signal

        os.kill(pid, signal.SIGTERM)
        print(f"[stop] Sent SIGTERM to PID {pid}{label}")
        return True
    except OSError:
        return False


def stop_saved_stack(*, quiet: bool = False) -> int:
    """Stop processes recorded in .stack/state.json. Returns count stopped."""
    state = _read_state()
    stopped = 0
    if state:
        for entry in state.get("processes") or []:
            pid = int(entry.get("pid") or 0)
            name = str(entry.get("name") or "")
            if _pid_alive(pid):
                if kill_pid_tree(pid, name=name):
                    stopped += 1
            elif not quiet:
                print(f"[stop] PID {pid} ({name}) already exited")
    _clear_state()
    return stopped


def stop_orphan_mediamtx(*, quiet: bool = False) -> int:
    """Kill stray mediamtx.exe not tied to our console (common after closing CMD with X)."""
    if sys.platform != "win32":
        return 0
    r = subprocess.run(
        ["taskkill", "/IM", "mediamtx.exe", "/F"],
        capture_output=True,
        text=True,
        creationflags=CREATE_NO_WINDOW,
    )
    if r.returncode == 0:
        if not quiet:
            print("[stop] Ended mediamtx.exe process(es)")
        return 1
    return 0


def cleanup_before_start(*, quiet: bool = False) -> None:
    n = stop_saved_stack(quiet=quiet)
    m = stop_orphan_mediamtx(quiet=quiet)
    if not quiet and n == 0 and m == 0:
        print("[stack] No leftover stack processes found")


def register_child(proc: subprocess.Popen, name: str) -> subprocess.Popen:
    _children.append(proc)
    _persist_state()
    return proc


def _persist_state() -> None:
    rows: list[dict[str, Any]] = []
    for proc in _children:
        if proc.poll() is None:
            rows.append({"name": getattr(proc, "_stack_name", "?"), "pid": proc.pid})
    if rows:
        _write_state(rows)
    else:
        _clear_state()


def shutdown_all() -> None:
    for proc in list(_children):
        if proc.poll() is None:
            kill_pid_tree(proc.pid, name=getattr(proc, "_stack_name", ""))
    _children.clear()
    _clear_state()


def popen_service(
    name: str,
    args: list[str],
    *,
    cwd: Path,
    env: dict[str, str] | None = None,
) -> subprocess.Popen:
    kw: dict = {
        "args": args,
        "cwd": str(cwd),
        "stdout": subprocess.PIPE,
        "stderr": subprocess.STDOUT,
        "env": env,
    }
    if sys.platform == "win32":
        kw["creationflags"] = CREATE_NO_WINDOW
    proc = subprocess.Popen(**kw)
    proc._stack_name = name  # type: ignore[attr-defined]
    return register_child(proc, name)


def install_console_shutdown_handler() -> None:
    if sys.platform != "win32":
        return
    import ctypes
    from ctypes import wintypes

    HandlerRoutine = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.DWORD)

    def _handler(ctrl_type: int) -> bool:
        # CTRL_C_EVENT, CTRL_BREAK, CTRL_CLOSE, logoff, shutdown
        if ctrl_type in (0, 1, 2, 5, 6):
            shutdown_all()
        return True

    ctypes.windll.kernel32.SetConsoleCtrlHandler(HandlerRoutine(_handler), True)
