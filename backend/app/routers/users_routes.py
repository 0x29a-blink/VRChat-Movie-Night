from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import auth
from ..db import get_db
from ..models import User

router = APIRouter(prefix="/api/users", tags=["users"], dependencies=[Depends(auth.require_admin)])


class UserCreate(BaseModel):
    username: str = Field(min_length=2, max_length=32)
    password: str = Field(min_length=1)
    role: str = "member"


class ResetPasswordBody(BaseModel):
    password: str = Field(min_length=1)


class WatchlistStatsExcludedBody(BaseModel):
    excluded: bool


@router.get("")
def list_users(db: Session = Depends(get_db)):
    users = db.query(User).order_by(User.username).all()
    return {"users": [u.to_dict() for u in users]}


@router.post("")
def create_user(body: UserCreate, db: Session = Depends(get_db)):
    username = body.username.strip().lower()
    if db.query(User).filter(User.username == username).first():
        raise HTTPException(400, "Username already taken")
    if body.role not in ("admin", "member"):
        raise HTTPException(400, "role must be admin or member")
    user = User(
        username=username,
        password_hash=auth.hash_password(body.password),
        role=body.role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"user": user.to_dict(), "password": body.password}


@router.delete("/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    if user.role == "admin":
        admin_count = db.query(User).filter(User.role == "admin").count()
        if admin_count <= 1:
            raise HTTPException(400, "Cannot delete the last admin")
    db.delete(user)
    db.commit()
    return {"ok": True}


@router.post("/{user_id}/reset-password")
def reset_password(user_id: int, body: ResetPasswordBody, db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    user.password_hash = auth.hash_password(body.password)
    db.commit()
    return {"ok": True, "password": body.password}


@router.put("/{user_id}/watchlist-stats-excluded")
def set_watchlist_stats_excluded(
    user_id: int,
    body: WatchlistStatsExcludedBody,
    db: Session = Depends(get_db),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    user.watchlist_stats_excluded = body.excluded
    user.watchlist_stats_excluded_at = datetime.now(timezone.utc) if body.excluded else None
    db.commit()
    db.refresh(user)
    return {"user": user.to_dict()}
