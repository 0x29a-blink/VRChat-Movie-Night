"""Feature flags checked against the users table."""

from sqlalchemy.orm import Session

from .auth import CurrentUser
from .models import User


def may_local_download(user: CurrentUser, db: Session) -> bool:
    row = db.get(User, user.id)
    return bool(row and row.allow_local_download)


def capabilities_for(user: User) -> dict[str, bool]:
    is_admin = user.role == "admin"
    return {
        "can_manage_settings": is_admin,
        "can_manage_users": is_admin,
        "can_manage_streaming": is_admin,
        "can_control_player": True,
        "can_download_to_server": True,
        "can_open_torbox_local_download": bool(user.allow_local_download),
        "can_manage_watchlist": True,
    }
