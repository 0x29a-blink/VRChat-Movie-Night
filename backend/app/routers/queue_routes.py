from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import auth
from ..playqueue.manager import manager

router = APIRouter(prefix="/api/queue", tags=["queue"],
                   dependencies=[Depends(auth.require_auth)])


class AddBody(BaseModel):
    library_id: int | None = None
    path: str | None = None
    title: str = ""


class ReorderBody(BaseModel):
    ids: list[int]


@router.get("")
def get_queue():
    return manager.snapshot()


@router.post("/add")
async def add(body: AddBody):
    try:
        if body.library_id is not None:
            return await manager.add_library_item(body.library_id)
        if body.path:
            return await manager.add_path(body.path, body.title)
        raise HTTPException(400, "library_id or path required")
    except ValueError as exc:
        raise HTTPException(404, str(exc))


@router.delete("/{item_id}")
async def remove(item_id: int):
    return await manager.remove(item_id)


@router.post("/clear")
async def clear():
    return await manager.clear()


@router.post("/reorder")
async def reorder(body: ReorderBody):
    return await manager.reorder(body.ids)
