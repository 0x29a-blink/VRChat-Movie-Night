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


@router.post("/aiostreams/reload")
def reload_aiostreams_config():
    """Re-read local AIOStreams install (BASE_URL + saved configure UUID)."""
    discovered = settings_store.get_aiostreams_discovered()
    return {
        "ok": bool(discovered) or not settings_store.is_aiostreams_auto(),
        "discovered": discovered,
        **settings_store.aiostreams_public_fields(),
    }


@router.post("/aiostreams/reset-auto")
def reset_aiostreams_auto():
    """Switch back to auto-detect from local AIOStreams and clear manual URL."""
    settings_store.reset_aiostreams_auto()
    return settings_store.public()


@router.post("/test-obs")
async def test_obs():
    controller._reset()  # noqa: SLF001
    return await aio(controller.connection_info)
