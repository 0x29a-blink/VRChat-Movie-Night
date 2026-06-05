"""Feature flags checked against the users table."""

from sqlalchemy.orm import Session

from .auth import CurrentUser
from .models import User


def may_local_download(user: CurrentUser, db: Session) -> bool:
    row = db.get(User, user.id)
    return bool(row and row.allow_local_download)
