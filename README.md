# smart-interview-scheduler

Smart Interview Scheduler. See `requirements.md` for the full specification and
`PROJECT_CONTEXT.md` for current build status.

## Repository layout

| Path        | Owner              | Contents                              |
| ----------- | ------------------ | ------------------------------------- |
| `backend/`  | Backend (Harshit)  | FastAPI service                      |
| `frontend/` | Frontend (teammate) | Next.js app (added separately)       |
| `*.md`      | shared             | Frozen specs + living context         |

## Local development

Requires Docker.

```bash
docker compose up --build
```

- Backend health: <http://localhost:8000/health>
- API docs: <http://localhost:8000/docs>

Run the backend checks directly (Python 3.12+):

```bash
cd backend
python -m venv .venv
. .venv/bin/activate            # Windows: .venv\Scripts\Activate.ps1
pip install -e ".[dev]"
ruff check .
pytest
```

## First administrator

A fresh deployment has no users. Create the first ADMIN by either path:

- **Web bootstrap** — set `ADMIN_BOOTSTRAP_TOKEN` to a long random secret, then
  `POST /api/v1/auth/bootstrap-admin` with an `X-Bootstrap-Token` header (the
  frontend `/setup` page does this). Allowed only while zero ADMIN users exist;
  it returns `409` permanently afterwards, and `404` when the token is unset.
- **CLI seed** — `python -m scripts.seed` (from `backend/`) provisions ADMIN and
  PANELIST accounts directly against the database. Use this for offline/CI setup
  or when you would rather not expose the bootstrap endpoint.

Further participants are added by an ADMIN via `POST /api/v1/users`
(CANDIDATE / PANELIST only — never ADMIN).

> Full setup instructions and the AI-usage disclosure are finalized in Phase 12
> (`IMPLEMENTATION.md`).
