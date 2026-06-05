import importlib

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, _migrate_schema
from app import db as db_module
from app import models  # noqa: F401

# Modules that do `from ..db import SessionLocal` keep a stale reference unless rebound.
_SESSIONLOCAL_MODULES = (
    "app.settings_store",
    "app.auth",
    "app.playqueue.manager",
    "app.library.scanner",
    "app.downloads.manager",
    "app.routers.library_routes",
    "app.routers.torbox_routes",
)


def _rebind_sessionlocal(factory) -> None:
    db_module.SessionLocal = factory
    for name in _SESSIONLOCAL_MODULES:
        mod = importlib.import_module(name)
        mod.SessionLocal = factory


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    db_module.engine = engine
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    _rebind_sessionlocal(session_factory)
    _migrate_schema()
    Session = db_module.SessionLocal
    session = Session()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client(db):
    from fastapi.testclient import TestClient

    from app.auth import COOKIE_NAME, hash_password, make_token
    from app.db import get_db
    from app.main import app
    from app.models import User

    def override_get_db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db

    admin = User(username="admin", password_hash=hash_password("test"), role="admin")
    db.add(admin)
    db.commit()

    test_client = TestClient(app)
    test_client.cookies.set(COOKIE_NAME, make_token(admin))
    yield test_client
    app.dependency_overrides.clear()
