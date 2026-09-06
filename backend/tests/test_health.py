"""Phase 1 smoke test: the app boots and the health endpoint answers.

The endpoint never raises, so this passes whether or not Postgres/Redis are up;
when the docker-compose stack (or CI service containers) is running, both checks
report "ok".
"""

from fastapi.testclient import TestClient

from app.main import app


def test_health_endpoint_shape():
    with TestClient(app) as client:
        resp = client.get("/health")

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] in {"ok", "degraded"}
    assert set(body["checks"]) == {"database", "redis"}
    assert all(v in {"ok", "error"} for v in body["checks"].values())
