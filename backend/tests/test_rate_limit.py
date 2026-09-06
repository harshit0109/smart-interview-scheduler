"""Phase 11 — Redis-backed rate limiting middleware.

Rate limiting is disabled suite-wide by an autouse fixture; every test here opts
back in via `rate_limited`, which also flushes the `ratelimit:*` Redis keys
before and after so windows never bleed between tests.
"""

import uuid

import pytest

from app.core.redis import redis_client

V1 = "/api/v1"
BAD_LOGIN = {"email": "nobody@example.com", "password": "wrong-pw-123"}


# --------------------------------------------------------------- strict tier ---


def test_strict_public_endpoint_blocks_after_limit(client, rate_limited):
    codes = [client.post(f"{V1}/auth/login", json=BAD_LOGIN).status_code for _ in range(10)]
    assert codes == [401] * 10  # all allowed, all normal auth failures

    resp = client.post(f"{V1}/auth/login", json=BAD_LOGIN)
    assert resp.status_code == 429
    assert resp.json()["error"]["code"] == "RATE_LIMITED"


def test_requests_under_limit_pass(client, rate_limited):
    for _ in range(9):
        assert client.post(f"{V1}/auth/login", json=BAD_LOGIN).status_code == 401


def test_window_resets_after_ttl(client, rate_limited):
    for _ in range(10):
        client.post(f"{V1}/auth/login", json=BAD_LOGIN)
    assert client.post(f"{V1}/auth/login", json=BAD_LOGIN).status_code == 429

    rate_limited.flush()  # simulate the 60s window expiring
    assert client.post(f"{V1}/auth/login", json=BAD_LOGIN).status_code == 401


# ---------------------------------------------------------- identity keying ----


def test_ip_identity_separation(client, rate_limited):
    hdr_a = {"x-forwarded-for": "203.0.113.10"}
    hdr_b = {"x-forwarded-for": "203.0.113.20"}
    for _ in range(10):
        client.post(f"{V1}/auth/login", json=BAD_LOGIN, headers=hdr_a)
    # IP A is now exhausted; IP B still has its full budget.
    assert client.post(f"{V1}/auth/login", json=BAD_LOGIN, headers=hdr_a).status_code == 429
    assert client.post(f"{V1}/auth/login", json=BAD_LOGIN, headers=hdr_b).status_code == 401


def test_user_identity_separation(client, make_user, rate_limited):
    a = make_user("CANDIDATE")
    b = make_user("CANDIDATE")
    # /interviews (list) is a candidate-facing STRICT endpoint keyed by user id.
    for _ in range(10):
        client.get(f"{V1}/interviews", headers=a.headers)
    assert client.get(f"{V1}/interviews", headers=a.headers).status_code == 429
    assert client.get(f"{V1}/interviews", headers=b.headers).status_code == 200


def test_authenticated_uses_user_bucket_not_ip(client, make_user, rate_limited):
    # Two users from the same (default) client host must not share a bucket.
    a = make_user("ADMIN")
    b = make_user("ADMIN")
    for _ in range(10):
        client.get(f"{V1}/interviews", headers=a.headers)
    assert client.get(f"{V1}/interviews", headers=b.headers).status_code == 200


# -------------------------------------------------------------- tier limits ---


def test_standard_tier_allows_more_than_strict(client, make_user, rate_limited):
    admin = make_user("ADMIN")
    # STANDARD (60/min): /users/me survives well past the strict ceiling.
    for _ in range(15):
        assert client.get(f"{V1}/users/me", headers=admin.headers).status_code == 200
    # STRICT (10/min): a candidate-facing endpoint on the same token 429s at 11.
    codes = [client.get(f"{V1}/interviews", headers=admin.headers).status_code for _ in range(11)]
    assert codes[:10] == [200] * 10
    assert codes[10] == 429


def test_expensive_recommendations_tier_is_five(client, make_user, rate_limited):
    admin = make_user("ADMIN")
    rid = uuid.uuid4()  # unknown request -> 404 from the service, but the bucket still counts
    codes = [
        client.post(f"{V1}/interviews/{rid}/recommendations", headers=admin.headers).status_code
        for _ in range(6)
    ]
    assert codes[:5] == [404] * 5
    assert codes[5] == 429


def test_expensive_booking_tier_is_ten(client, make_user, rate_limited):
    admin = make_user("ADMIN")
    rid = uuid.uuid4()
    codes = [
        client.post(
            f"{V1}/interviews/{rid}/book",
            json={"recommended_slot_id": str(uuid.uuid4())},
            headers=admin.headers,
        ).status_code
        for _ in range(11)
    ]
    assert codes[:10] == [404] * 10
    assert codes[10] == 429


# ----------------------------------------------------------------- exemption ---


def test_health_is_never_rate_limited(client, rate_limited):
    for _ in range(50):
        assert client.get("/health").status_code == 200


# ------------------------------------------------------------- fail-open path --


def test_redis_down_fails_open(client, rate_limited, monkeypatch, app_logs):
    async def _boom(*_a, **_k):
        raise ConnectionError("redis is down")

    monkeypatch.setattr(redis_client, "eval", _boom)

    codes = [client.post(f"{V1}/auth/login", json=BAD_LOGIN).status_code for _ in range(20)]
    assert 429 not in codes  # never blocked while Redis is unavailable
    assert any("Redis unavailable" in r.getMessage() for r in app_logs)


# --------------------------------------------------------- response contract ---


def test_429_uses_standard_error_envelope_and_headers(client, rate_limited):
    for _ in range(10):
        client.post(f"{V1}/auth/login", json=BAD_LOGIN)
    resp = client.post(f"{V1}/auth/login", json=BAD_LOGIN)

    assert resp.status_code == 429
    err = resp.json()["error"]
    assert err["code"] == "RATE_LIMITED"
    assert err["message"]
    assert err["field_errors"] is None
    assert len(err["trace_id"]) == 8

    assert 1 <= int(resp.headers["retry-after"]) <= 60
    assert resp.headers["x-ratelimit-limit"] == "10"
    assert resp.headers["x-ratelimit-remaining"] == "0"
    assert int(resp.headers["x-ratelimit-reset"]) > 0


def test_allowed_response_carries_ratelimit_headers(client, make_user, rate_limited):
    admin = make_user("ADMIN")
    resp = client.get(f"{V1}/users/me", headers=admin.headers)
    assert resp.status_code == 200
    assert resp.headers["x-ratelimit-limit"] == "60"
    assert int(resp.headers["x-ratelimit-remaining"]) == 59


# ------------------------------------------------------------ no side effects --


def test_rejected_request_never_reaches_handler(client, rate_limited, db_val):
    made = []
    for i in range(10):
        email = f"rl-nodb-{i}-{uuid.uuid4().hex[:6]}@example.com"
        body = {"email": email, "password": "Passw0rd1", "name": "RL", "timezone": "UTC"}
        assert client.post(f"{V1}/auth/register", json=body).status_code == 201
        made.append(email)

    blocked_email = f"rl-nodb-blocked-{uuid.uuid4().hex[:6]}@example.com"
    resp = client.post(
        f"{V1}/auth/register",
        json={"email": blocked_email, "password": "Passw0rd1", "name": "RL", "timezone": "UTC"},
    )
    assert resp.status_code == 429

    created = db_val("SELECT count(*) FROM users WHERE email LIKE 'rl-nodb-%'")
    assert created == len(made)  # the 429'd registration created nothing
    assert db_val(
        "SELECT count(*) FROM users WHERE email = :e", {"e": blocked_email}
    ) == 0


@pytest.mark.parametrize("path", ["/auth/login", "/auth/register", "/auth/google", "/auth/refresh"])
def test_all_public_auth_routes_are_strict(client, rate_limited, path):
    # 11th call on each route 429s regardless of the request body being invalid.
    last = None
    for _ in range(11):
        last = client.post(f"{V1}{path}", json={})
    assert last.status_code == 429
    rate_limited.flush()
