import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base
from app import models  # noqa: F401


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
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
