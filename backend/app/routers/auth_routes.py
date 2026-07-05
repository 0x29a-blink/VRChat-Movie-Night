from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import auth
from ..db import get_db
from ..events import record_event
from ..models import User
from ..permissions import capabilities_for

router = APIRouter(prefix="/api", tags=["auth"])


class LoginBody(BaseModel):
    username: str
    password: str


class PasswordBody(BaseModel):
    new_password: str = Field(min_length=8)


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


@router.post("/login")
def login(body: LoginBody, request: Request, response: Response, db: Session = Depends(get_db)):
    token = auth.attempt_login(body.username, body.password, _client_ip(request), db)
    response.set_cookie(
        key=auth.COOKIE_NAME,
        value=token,
        max_age=auth.MAX_AGE,
        **auth.session_cookie_kwargs(request),
    )
    record_event("login", body.username.strip().lower())
    return {"ok": True}


@router.post("/logout")
def logout(request: Request, response: Response):
    response.delete_cookie(auth.COOKIE_NAME, **auth.session_cookie_kwargs(request))
    return {"ok": True}


@router.get("/me")
def me(request: Request, db: Session = Depends(get_db)):
    cu = auth.is_authenticated(request)
    if not cu:
        return {"authenticated": False, "user": None}
    row = db.get(User, cu.id)
    if not row:
        return {"authenticated": False, "user": None}
    data = row.to_dict()
    data["capabilities"] = capabilities_for(row)
    return {"authenticated": True, "user": data}


@router.post("/password")
def change_password(
    body: PasswordBody,
    user: auth.CurrentUser = Depends(auth.require_auth),
    db: Session = Depends(get_db),
):
    row = db.get(User, user.id)
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    row.password_hash = auth.hash_password(body.new_password)
    row.session_version = int(row.session_version or 0) + 1
    db.commit()
    return {"ok": True}
