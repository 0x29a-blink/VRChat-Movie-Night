from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import auth, settings_store
from ..obs.controller import aio, controller
from ..playqueue.manager import manager

router = APIRouter(prefix="/api/player", tags=["player"],
                   dependencies=[Depends(auth.require_auth)])


class PlayBody(BaseModel):
    index: int | None = None


class SeekBody(BaseModel):
    ms: int


class SkipBody(BaseModel):
    seconds: int | None = None


class VolumeBody(BaseModel):
    percent: int


class LoopBody(BaseModel):
    enabled: bool


@router.get("/status")
async def status():
    try:
        st = await aio(controller.status)
    except Exception as exc:
        st = {"media_state": "", "duration": 0, "cursor": 0, "error": str(exc)}
    snap = manager.snapshot()
    return {
        **st,
        "current": snap.get("current"),
        "current_index": snap.get("current_index"),
        **manager._player_prefs(),
    }


@router.post("/play")
async def play(body: PlayBody):
    try:
        if body.index is not None:
            return await manager.play_index(body.index)
        return await manager.play_current_or_first()
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        raise HTTPException(502, f"OBS error: {exc}")


@router.post("/pause")
async def pause():
    await aio(controller.pause)
    await manager.broadcast_player()
    return {"ok": True}


@router.post("/toggle")
async def toggle():
    state = await aio(controller.toggle)
    await manager.broadcast_player()
    return {"ok": True, "state": state}


@router.post("/resume")
async def resume():
    await aio(controller.play)
    await manager.broadcast_player()
    return {"ok": True}


@router.post("/stop")
async def stop():
    await aio(controller.stop)
    await manager.broadcast_player()
    return {"ok": True}


@router.post("/next")
async def next_():
    return await manager.next()


@router.post("/prev")
async def prev():
    return await manager.prev()


@router.post("/seek")
async def seek(body: SeekBody):
    await aio(controller.seek, body.ms)
    await manager.broadcast_player()
    return {"ok": True}


@router.post("/skip")
async def skip(body: SkipBody):
    secs = body.seconds if body.seconds is not None else int(settings_store.get("skip_large"))
    await aio(controller.skip, secs)
    await manager.broadcast_player()
    return {"ok": True}


@router.post("/volume")
async def set_volume(body: VolumeBody):
    percent = max(0, min(100, int(body.percent)))
    mul = percent / 100.0
    settings_store.set_value("obs_media_volume", mul)
    try:
        await aio(controller.set_volume, mul)
    except Exception as exc:
        raise HTTPException(502, f"OBS error: {exc}")
    await manager.broadcast_player()
    return {"ok": True, "volume_percent": percent}


@router.post("/loop")
async def set_loop(body: LoopBody):
    settings_store.set_value("queue_loop", bool(body.enabled))
    await manager.broadcast_player()
    return {"ok": True, "queue_loop": bool(body.enabled)}
