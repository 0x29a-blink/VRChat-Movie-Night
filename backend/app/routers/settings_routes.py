from fastapi import APIRouter, Depends

from .. import auth, settings_store
from ..downloads.manager import manager as download_manager
from ..obs.controller import aio, controller
from ..obs.setup import apply_obs_recommendations, audit_obs
from ..provider_checks import check_aiostreams, check_tmdb, check_torbox

router = APIRouter(prefix="/api/settings", tags=["settings"],
                   dependencies=[Depends(auth.require_admin)])


@router.get("")
def get_settings():
    return settings_store.public()


@router.put("")
def update_settings(values: dict):
    settings_store.update(values)
    # apply concurrency immediately + force OBS reconnect on next call
    if "max_concurrent_downloads" in values:
        download_manager.set_concurrency_limit(
            int(settings_store.get("max_concurrent_downloads", 1) or 1)
        )
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
    info = await aio(controller.connection_info)
    audit = await aio(audit_obs, controller)
    return {**info, "audit": audit}


@router.get("/obs-audit")
async def obs_audit():
    controller._reset()  # noqa: SLF001
    return await aio(audit_obs, controller)


@router.post("/obs-apply")
async def obs_apply():
    """Apply Movie Night stream + media source defaults where possible."""
    controller._reset()  # noqa: SLF001
    return await aio(apply_obs_recommendations, controller)


@router.post("/test-tmdb")
async def test_tmdb():
    return await check_tmdb(settings_store.get("tmdb_api_key", ""))


@router.post("/test-torbox")
async def test_torbox():
    return await check_torbox(settings_store.get("torbox_api_key", ""))


@router.post("/test-aiostreams")
async def test_aiostreams():
    return await check_aiostreams(settings_store.get_aiostreams_effective())
