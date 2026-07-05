from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from .. import auth
from ..db import get_db
from ..models import AppEvent

router = APIRouter(prefix="/api/events", tags=["events"],
                   dependencies=[Depends(auth.require_auth)])

_MAX_LIMIT = 200


@router.get("")
def list_events(
    limit: int = Query(50, ge=1, le=_MAX_LIMIT),
    before_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
):
    q = db.query(AppEvent).order_by(AppEvent.id.desc())
    if before_id is not None:
        q = q.filter(AppEvent.id < before_id)
    rows = q.limit(limit).all()
    events = [r.to_dict() for r in rows]
    has_more = len(rows) == limit
    return {"events": events, "has_more": has_more}
