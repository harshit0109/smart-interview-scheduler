"""RBAC: require_role() gates by role. Uses a throwaway probe route mounted here."""

import asyncio

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import settings
from app.core.deps import require_role
from app.core.security import create_access_token
from app.main import app

V1 = "/api/v1"

_probe = APIRouter()


@_probe.get("/_admin-only", dependencies=[Depends(require_role("ADMIN"))])
async def _admin_only() -> dict:
    return {"ok": True}


app.include_router(_probe, prefix=V1)


def _make_user(email: str, role: str) -> str:
    """Insert a user directly; return a valid access token for them."""

    async def _insert() -> str:
        eng = create_async_engine(settings.database_url)
        async with eng.begin() as conn:
            uid = await conn.scalar(
                text(
                    "INSERT INTO users (email, name, role, auth_provider) "
                    "VALUES (:e, :n, :r, 'PASSWORD') RETURNING id"
                ),
                {"e": email, "n": email, "r": role},
            )
        await eng.dispose()
        return create_access_token(uid, role)

    return asyncio.run(_insert())


def test_wrong_role_gets_403(client):
    token = _make_user("panelist@example.com", "PANELIST")
    resp = client.get(f"{V1}/_admin-only", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "FORBIDDEN"


def test_right_role_passes(client):
    token = _make_user("admin@example.com", "ADMIN")
    resp = client.get(f"{V1}/_admin-only", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200


def test_no_token_gets_401(client):
    assert client.get(f"{V1}/_admin-only").status_code == 401
