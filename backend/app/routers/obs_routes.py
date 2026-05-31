from fastapi import APIRouter, Depends

from .. import auth
from ..obs.controller import aio, controller

router = APIRouter(prefix="/api/obs", tags=["obs"],
                   dependencies=[Depends(auth.require_auth)])


@router.get("/status")
async def status():
    return await aio(controller.connection_info)


@router.post("/stream/start")
async def stream_start():
    return await aio(controller.ensure_stream)


@router.post("/stream/stop")
async def stream_stop():
    await aio(controller.stop_stream)
    return {"ok": True}
