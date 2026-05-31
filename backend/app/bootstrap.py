from sqlalchemy.orm import Session

from . import auth, settings_store
from .config import settings
from .models import User


def bootstrap_users(db: Session) -> None:
    if db.query(User).count() > 0:
        return
    password = settings_store.get("app_password", settings.app_password)
    admin = User(
        username="admin",
        password_hash=auth.hash_password(password),
        role="admin",
    )
    db.add(admin)
    db.commit()
