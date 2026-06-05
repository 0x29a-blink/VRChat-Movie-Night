"""Stream encoder / video presets and upload speed probes."""

from __future__ import annotations

import time

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from .. import auth
from ..network_speed import measure_upload_from_bytes, run_speedtest_json
from ..obs.controller import OBSBusyError, OBSNotConnectedError, aio, controller
from ..obs.stream_settings import StreamSettingsService

router = APIRouter(prefix="/api/stream", tags=["stream"], dependencies=[Depends(auth.require_auth)])


def _svc() -> StreamSettingsService:
    return StreamSettingsService(controller)


class PresetBody(BaseModel):
    preset_id: str


@router.get("/presets")
async def list_presets():
    return await aio(_svc().list_presets)


@router.get("/encoder")
async def get_encoder_settings():
    try:
        return await aio(_svc().get_encoder_settings)
    except OBSNotConnectedError as exc:
        raise HTTPException(502, str(exc)) from exc
    except OBSBusyError as exc:
        raise HTTPException(503, str(exc)) from exc


@router.post("/encoder/apply")
async def apply_encoder_preset(body: PresetBody):
    try:
        return await aio(_svc().apply_encoder_preset, body.preset_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except OBSNotConnectedError as exc:
        raise HTTPException(502, str(exc)) from exc
    except OBSBusyError as exc:
        raise HTTPException(503, str(exc)) from exc


@router.get("/video")
async def get_video_settings():
    try:
        return await aio(_svc().get_video_settings)
    except OBSNotConnectedError as exc:
        raise HTTPException(502, str(exc)) from exc
    except OBSBusyError as exc:
        raise HTTPException(503, str(exc)) from exc


@router.post("/video/apply")
async def apply_video_preset(body: PresetBody):
    try:
        return await aio(_svc().apply_video_preset, body.preset_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(409, str(exc)) from exc
    except OBSNotConnectedError as exc:
        raise HTTPException(502, str(exc)) from exc
    except OBSBusyError as exc:
        raise HTTPException(503, str(exc)) from exc


@router.get("/speedtest/host")
async def host_speedtest():
    """Measure upload on the PC running the Movie Night server (best for the stream host)."""
    return await run_speedtest_json()


@router.post("/speedtest/upload")
async def browser_upload_speedtest(request: Request):
    """
    Browser sends raw bytes (e.g. 2–4 MB). Measures throughput to this server.
    On the stream host PC, use /speedtest/host instead — loopback upload is not WAN speed.
    """
    started = time.monotonic()
    total = 0
    max_bytes = 8 * 1024 * 1024
    async for chunk in request.stream():
        total += len(chunk)
        if total >= max_bytes:
            break
    elapsed = time.monotonic() - started
    result = measure_upload_from_bytes(total, elapsed)
    if not result.get("ok"):
        raise HTTPException(400, result.get("error", "upload test failed"))
    result["note"] = (
        "This measures upload to the Movie Night server. "
        "If you are not on the streaming PC, use Host speed test on the machine running OBS."
    )
    return result
