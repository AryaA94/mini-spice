import os

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture()
def client(tmp_path):
    # TEST_DATABASE_URL lets CI run the same suite against PostgreSQL.
    url = os.environ.get("TEST_DATABASE_URL", f"sqlite:///{tmp_path}/test.db")
    app = create_app(url, static_dir=tmp_path / "no-frontend")
    with TestClient(app) as c:
        yield c
    if url.startswith("postgresql"):
        from app.db import Base, make_engine
        Base.metadata.drop_all(make_engine(url))
