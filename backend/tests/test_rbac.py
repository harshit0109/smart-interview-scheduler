"""RBAC: require_role() gates by role. Uses a throwaway probe route mounted here."""

from fastapi import APIRouter, Depends

from app.core.deps import require_role
from app.main import app

V1 = "/api/v1"

_probe = APIRouter()


@_probe.get("/_admin-only", dependencies=[Depends(require_role("ADMIN"))])
async def _admin_only() -> dict:
    return {"ok": True}


app.include_router(_probe, prefix=V1)


def test_wrong_role_gets_403(client, make_user):
    panelist = make_user("PANELIST")
    resp = client.get(f"{V1}/_admin-only", headers=panelist.headers)
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "FORBIDDEN"


def test_right_role_passes(client, make_user):
    admin = make_user("ADMIN")
    resp = client.get(f"{V1}/_admin-only", headers=admin.headers)
    assert resp.status_code == 200


def test_no_token_gets_401(client):
    assert client.get(f"{V1}/_admin-only").status_code == 401
