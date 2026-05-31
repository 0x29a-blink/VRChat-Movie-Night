from fastapi import APIRouter, Depends

from .. import auth, settings_store
from ..downloads.manager import manager as download_manager
from ..obs.controller import aio, controller

router = APIRouter(prefix="/api/settings", tags=["settings"],
                   dependencies=[Depends(auth.require_auth)])


@router.get("")
def get_settings():
    return settings_store.public()


@router.put("")
def update_settings(values: dict):
    settings_store.update(values)
    # apply concurrency immediately + force OBS reconnect on next call
    if "max_concurrent_downloads" in values:
        download_manager.start()
    controller._reset()  # noqa: SLF001 - intentional internal reset
    return settings_store.public()


@router.post("/test-obs")
async def test_obs():
    controller._reset()  # noqa: SLF001
    return await aio(controller.connection_info)
