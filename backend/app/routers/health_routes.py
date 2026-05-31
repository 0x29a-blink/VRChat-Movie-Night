from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from .. import auth
from ..db import get_db
from ..models import User
from ..network_utils import build_hls_url, check_mediamtx_stream
from ..obs.controller import aio, controller
from ..tool_checks import check_all_tools

router = APIRouter(prefix="/api/health", tags=["health"])


def _build_issues(
    *,
    obs_connected: bool,
    obs_streaming: bool,
    mediamtx_running: bool,
    hls_stream_active: bool,
    user_count: int,
    tools: list[dict],
) -> list[str]:
    issues: list[str] = []
    if not obs_connected:
        issues.append("OBS WebSocket is not connected")
    if not mediamtx_running:
        issues.append("MediaMTX is not running (port 8888)")
    if user_count <= 0:
        issues.append("No user accounts configured")
    for tool in tools:
        if not tool.get("ok"):
            issues.append(f"{tool.get('name', 'Tool')} unavailable: {tool.get('detail', 'missing')}")
    if obs_streaming and not hls_stream_active:
        issues.append("OBS is streaming but the HLS feed is not active")
    return issues


@router.get("/preflight")
async def preflight(
    request: Request,
    db: Session = Depends(get_db),
    _: auth.CurrentUser = Depends(auth.require_auth),
):
    obs = await aio(controller.connection_info)
    obs_connected = bool(obs.get("connected"))
    obs_streaming = bool(obs.get("streaming"))

    mediamtx_running, hls_stream_active, hls_error, hls_rel_path = await check_mediamtx_stream(
        obs_streaming=obs_streaming
    )
    hls_url = build_hls_url(request, hls_rel_path)

    user_count = db.query(User).count()
    tools = await check_all_tools()
    issues = _build_issues(
        obs_connected=obs_connected,
        obs_streaming=obs_streaming,
        mediamtx_running=mediamtx_running,
        hls_stream_active=hls_stream_active,
        user_count=user_count,
        tools=tools,
    )

    return {
        "api": True,
        "obs_connected": obs_connected,
        "obs_streaming": obs_streaming,
        "mediamtx_running": mediamtx_running,
        "hls_stream_active": hls_stream_active,
        "hls_reachable": hls_stream_active,
        "hls_error": hls_error,
        "hls_url": hls_url,
        "hls_path": hls_rel_path,
        "users": user_count,
        "tools": tools,
        "issues": issues,
        "checklist_ok": len(issues) == 0,
        "ready": obs_connected and mediamtx_running and hls_stream_active and user_count > 0,
    }


@router.get("/hls-url")
async def hls_url(request: Request, _: auth.CurrentUser = Depends(auth.require_auth)):
    obs = await aio(controller.connection_info)
    _, active, _, rel_path = await check_mediamtx_stream(obs_streaming=bool(obs.get("streaming")))
    return {"url": build_hls_url(request, rel_path), "active": active, "path": rel_path}
