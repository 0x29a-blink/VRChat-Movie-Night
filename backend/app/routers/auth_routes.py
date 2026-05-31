from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import auth
from ..db import get_db
from ..models import User

router = APIRouter(prefix="/api", tags=["auth"])


class LoginBody(BaseModel):
    username: str
    password: str


class PasswordBody(BaseModel):
    new_password: str = Field(min_length=1)


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


@router.post("/login")
def login(body: LoginBody, request: Request, response: Response, db: Session = Depends(get_db)):
    token = auth.attempt_login(body.username, body.password, _client_ip(request), db)
    response.set_cookie(
        key=auth.COOKIE_NAME,
        value=token,
        max_age=auth.MAX_AGE,
        httponly=True,
        samesite="lax",
    )
    return {"ok": True}


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(auth.COOKIE_NAME)
    return {"ok": True}


@router.get("/me")
def me(request: Request):
    user = auth.is_authenticated(request)
    if not user:
        return {"authenticated": False, "user": None}
    return {"authenticated": True, "user": user.to_dict()}


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
    db.commit()
    return {"ok": True}
