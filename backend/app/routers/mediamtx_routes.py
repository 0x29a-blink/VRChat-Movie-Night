from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import auth
from ..mediamtx.settings import apply_preset, status

router = APIRouter(
    prefix="/api/mediamtx",
    tags=["mediamtx"],
    dependencies=[Depends(auth.require_admin)],
)


class PresetBody(BaseModel):
    preset_id: str


@router.get("/status")
async def mediamtx_status():
    return await status()


@router.post("/preset/apply")
async def mediamtx_apply_preset(body: PresetBody):
    try:
        return await apply_preset(body.preset_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(500, str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(502, str(exc)) from exc
