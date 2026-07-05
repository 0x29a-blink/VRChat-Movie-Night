from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import auth
from ..config import settings
from ..playqueue.manager import manager

router = APIRouter(prefix="/api/queue", tags=["queue"],
                   dependencies=[Depends(auth.require_auth)])

VIDEO_EXTS = {".mp4", ".mkv", ".webm", ".mov", ".ts", ".m4v", ".avi"}


class AddBody(BaseModel):
    library_id: int | None = None
    path: str | None = None
    title: str = ""


class ReorderBody(BaseModel):
    ids: list[int]


@router.get("")
def get_queue():
    return manager.snapshot()


def _validate_raw_queue_path(raw_path: str) -> str:
    try:
        path = Path(raw_path).expanduser().resolve()
        library_root = settings.library_path.resolve()
    except OSError as exc:
        raise HTTPException(400, f"Invalid path: {exc}") from exc
    if not path.is_file():
        raise HTTPException(404, "File not found")
    if path.suffix.lower() not in VIDEO_EXTS:
        raise HTTPException(400, "Only local video files can be queued by path")
    try:
        path.relative_to(library_root)
    except ValueError as exc:
        raise HTTPException(400, "Raw queue paths must be inside the library folder") from exc
    return str(path)


@router.post("/add")
async def add(body: AddBody, user: auth.CurrentUser = Depends(auth.require_auth)):
    try:
        if body.library_id is not None:
            return await manager.add_library_item(body.library_id, user=user)
        if body.path:
            if not user.is_admin:
                raise HTTPException(403, "Admin only")
            return await manager.add_path(_validate_raw_queue_path(body.path), body.title, user=user)
        raise HTTPException(400, "library_id or path required")
    except ValueError as exc:
        raise HTTPException(404, str(exc))


@router.delete("/{item_id}")
async def remove(item_id: int, user: auth.CurrentUser = Depends(auth.require_auth)):
    return await manager.remove(item_id, user=user)


@router.post("/clear")
async def clear(user: auth.CurrentUser = Depends(auth.require_auth)):
    return await manager.clear(user=user)


@router.post("/prepare")
async def prepare_all():
    return await manager.prepare_all()


@router.post("/{item_id}/prepare")
async def prepare_item(item_id: int):
    try:
        return await manager.prepare_item(item_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc))


@router.post("/reorder")
async def reorder(body: ReorderBody):
    return await manager.reorder(body.ids)
