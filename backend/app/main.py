import asyncio
import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path

from obsws_python.error import OBSSDKRequestError


class _TransientOBSLogFilter(logging.Filter):
    """obsws_python logs full tracebacks for expected transient OBS busy responses."""

    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        if "returned code 207" in msg:
            return False
        if record.exc_info and record.exc_info[1] is not None:
            exc = record.exc_info[1]
            if isinstance(exc, OBSSDKRequestError) and exc.code in {207}:
                return False
        return True


def _configure_logging() -> None:
    filt = _TransientOBSLogFilter()
    for name in ("obsws_python", "obsws_python.reqs"):
        obs_logger = logging.getLogger(name)
        obs_logger.addFilter(filt)


_configure_logging()

from fastapi import FastAPI, WebSocket, WebSocketDisconnect  # noqa: E402 (must follow _configure_logging())
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import FileResponse  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware  # noqa: E402

from . import auth  # noqa: E402
from .config import settings  # noqa: E402
from .db import init_db  # noqa: E402
from .downloads.manager import manager as download_manager  # noqa: E402
from .obs.controller import controller  # noqa: E402
from .playqueue.manager import manager as queue_manager  # noqa: E402
from .routers import (  # noqa: E402
    auth_routes,
    backup_routes,
    browse_routes,
    downloads_routes,
    events_routes,
    health_routes,
    library_routes,
    mediamtx_routes,
    obs_routes,
    player_routes,
    queue_routes,
    search_routes,
    session_routes,
    settings_routes,
    stats_routes,
    stream_routes,
    torbox_routes,
    users_routes,
    watchlist_routes,
)
from .ws import hub  # noqa: E402

_loop: asyncio.AbstractEventLoop | None = None

logger = logging.getLogger(__name__)


def schedule(coro) -> None:
    """Schedule a coroutine from any thread (used by OBS event callbacks)."""
    if _loop is not None:
        asyncio.run_coroutine_threadsafe(coro, _loop)


@asynccontextmanager
async def lifespan(_: FastAPI):
    global _loop
    _loop = asyncio.get_running_loop()
    init_db()
    hub.bind_loop(_loop)
    download_manager.start()
    controller.set_playback_ended_callback(queue_manager.on_playback_ended)

    async def _initial_scan():
        from .library.scanner import scan_all
        await asyncio.to_thread(scan_all)
        await hub.broadcast("library_update", {})

    tasks = [
        asyncio.create_task(_initial_scan()),
        asyncio.create_task(_player_poller()),
    ]
    try:
        yield
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        _loop = None


app = FastAPI(title="VRChat Movie Night", lifespan=lifespan)


def _cors_origins() -> list[str]:
    origins = ["http://localhost:5173", "http://127.0.0.1:5173"]
    extra = (settings.cors_origins or "").strip()
    if extra:
        origins.extend(part.strip() for part in extra.split(",") if part.strip())
    return origins


if settings.behind_proxy:
    app.add_middleware(ProxyHeadersMiddleware, trusted_hosts="*")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


for r in (
    auth_routes.router,
    downloads_routes.router,
    search_routes.router,
    browse_routes.router,
    library_routes.router,
    queue_routes.router,
    player_routes.router,
    obs_routes.router,
    settings_routes.router,
    stream_routes.router,
    mediamtx_routes.router,
    torbox_routes.router,
    stats_routes.router,
    backup_routes.router,
    users_routes.router,
    watchlist_routes.router,
    health_routes.router,
    events_routes.router,
    session_routes.router,
):
    app.include_router(r)


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    token = ws.cookies.get(auth.COOKIE_NAME)
    if not auth.ws_authenticated(token):
        await ws.close(code=1008)
        return
    await hub.connect(ws)
    try:
        snap = queue_manager.snapshot()
        await ws.send_json({"event": "queue_update", "data": snap})
        try:
            from .obs.controller import aio, controller

            status = await aio(controller.status)
        except Exception:
            status = {"media_state": "", "duration": 0, "cursor": 0}
        await ws.send_json(
            {
                "event": "player_update",
                "data": {
                    "media_state": status.get("media_state", ""),
                    "duration": status.get("duration", 0),
                    "cursor": status.get("cursor", 0),
                    "current": snap.get("current"),
                    "current_index": snap.get("current_index"),
                    **queue_manager._player_prefs(),
                },
            }
        )
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        hub.disconnect(ws)
    except Exception:
        hub.disconnect(ws)


async def _player_poller() -> None:
    last_error_log = 0.0
    while True:
        await asyncio.sleep(1.0)
        try:
            await queue_manager.poll_playback_end()
            await queue_manager.poll_playback_stall()
            await queue_manager.broadcast_player()
        except Exception:
            now = time.monotonic()
            if now - last_error_log >= 60.0:
                last_error_log = now
                logger.exception("Player poller iteration failed (auto-advance may be degraded)")


# ---- Thumbnails ---------------------------------------------------------
settings.thumbnails_path.mkdir(parents=True, exist_ok=True)
app.mount("/thumbnails", StaticFiles(directory=str(settings.thumbnails_path)), name="thumbnails")


# ---- Frontend (served if built) -----------------------------------------
FRONTEND_DIST = Path(__file__).resolve().parents[1].parent / "frontend" / "dist"


@app.get("/health")
def health():
    return {"ok": True}


if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIST / "assets")), name="assets")

    @app.get("/{full_path:path}")
    def spa(full_path: str):
        candidate = FRONTEND_DIST / full_path
        if full_path and candidate.is_file():
            return FileResponse(str(candidate))
        return FileResponse(str(FRONTEND_DIST / "index.html"))
