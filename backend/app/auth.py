import time
from dataclasses import dataclass

import bcrypt
from fastapi import Cookie, Depends, HTTPException, Request, status
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from sqlalchemy.orm import Session

from .config import settings
from .db import SessionLocal, get_db
from .models import User

COOKIE_NAME = "vrcsession"
MAX_AGE = 60 * 60 * 24 * 7  # 7 days

_serializer = URLSafeTimedSerializer(settings.secret_key, salt="vrc-session")

_attempts: dict[str, list] = {}
_MAX_FAILS = 6
_LOCK_SECONDS = 60


@dataclass
class CurrentUser:
    id: int
    username: str
    role: str

    def to_dict(self) -> dict:
        return {"id": self.id, "username": self.username, "role": self.role}

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode(), password_hash.encode())


def make_token(user: User) -> str:
    return _serializer.dumps({"user_id": user.id, "role": user.role})


def _parse_token(token: str) -> dict | None:
    try:
        return _serializer.loads(token, max_age=MAX_AGE)
    except (BadSignature, SignatureExpired, Exception):
        return None


def get_user_from_token(token: str | None, db: Session) -> User | None:
    if not token:
        return None
    data = _parse_token(token)
    if not data or "user_id" not in data:
        return None
    return db.get(User, data["user_id"])


def check_locked(ip: str) -> None:
    rec = _attempts.get(ip)
    if rec and rec[1] > time.time():
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed attempts. Try again shortly.",
        )


def register_fail(ip: str) -> None:
    rec = _attempts.get(ip, [0, 0])
    rec[0] += 1
    if rec[0] >= _MAX_FAILS:
        rec[1] = time.time() + _LOCK_SECONDS
        rec[0] = 0
    _attempts[ip] = rec


def register_success(ip: str) -> None:
    _attempts.pop(ip, None)


def attempt_login(username: str, password: str, ip: str, db: Session) -> str:
    check_locked(ip)
    user = db.query(User).filter(User.username == username.strip().lower()).first()
    if not user or not verify_password(password, user.password_hash):
        register_fail(ip)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
        )
    register_success(ip)
    return make_token(user)


def require_auth(
    vrcsession: str | None = Cookie(default=None),
    db: Session = Depends(get_db),
) -> CurrentUser:
    user = get_user_from_token(vrcsession, db)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        )
    return CurrentUser(id=user.id, username=user.username, role=user.role)


def require_admin(user: CurrentUser = Depends(require_auth)) -> CurrentUser:
    if not user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")
    return user


def is_authenticated(request: Request) -> CurrentUser | None:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        return None
    db = SessionLocal()
    try:
        user = get_user_from_token(token, db)
        if not user:
            return None
        return CurrentUser(id=user.id, username=user.username, role=user.role)
    finally:
        db.close()


def ws_authenticated(token: str | None) -> bool:
    if not token:
        return False
    data = _parse_token(token)
    return bool(data and "user_id" in data)
