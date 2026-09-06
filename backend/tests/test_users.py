"""GET /users — ADMIN-only directory for the interview-creation flow (FR-012)."""

V1 = "/api/v1"


def test_list_users_filters_by_role(client, make_user):
    admin = make_user("ADMIN")
    c1 = make_user("CANDIDATE")
    c2 = make_user("CANDIDATE")
    make_user("PANELIST")

    resp = client.get(f"{V1}/users", params={"role": "CANDIDATE"}, headers=admin.headers)
    assert resp.status_code == 200
    body = resp.json()
    assert {u["id"] for u in body} == {str(c1.id), str(c2.id)}
    assert all(u["role"] == "CANDIDATE" for u in body)


def test_list_users_response_shape(client, make_user):
    admin = make_user("ADMIN")
    panelist = make_user("PANELIST", timezone="Europe/London")

    resp = client.get(f"{V1}/users", params={"role": "PANELIST"}, headers=admin.headers)
    assert resp.status_code == 200
    (row,) = resp.json()
    assert set(row) == {"id", "name", "email", "timezone", "role"}
    assert row["id"] == str(panelist.id)
    assert row["email"] == panelist.email
    assert row["timezone"] == "Europe/London"
    assert row["role"] == "PANELIST"


def test_list_users_requires_admin(client, make_user):
    candidate = make_user("CANDIDATE")
    panelist = make_user("PANELIST")
    for actor in (candidate, panelist):
        resp = client.get(
            f"{V1}/users", params={"role": "CANDIDATE"}, headers=actor.headers
        )
        assert resp.status_code == 403


def test_list_users_requires_auth(client):
    assert client.get(f"{V1}/users", params={"role": "CANDIDATE"}).status_code == 401


def test_list_users_rejects_bad_role(client, make_user):
    admin = make_user("ADMIN")
    for bad in ("ADMIN", "", "candidate", "everyone"):
        resp = client.get(f"{V1}/users", params={"role": bad}, headers=admin.headers)
        assert resp.status_code == 422
    assert client.get(f"{V1}/users", headers=admin.headers).status_code == 422
