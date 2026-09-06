# smart-interview-scheduler

Smart Interview Scheduler. See `requirements.md` for the full specification and
`PROJECT_CONTEXT.md` for current build status.

## Repository layout

| Path        | Owner              | Contents                              |
| ----------- | ------------------ | ------------------------------------- |
| `backend/`  | Backend (Harshit)  | FastAPI service                      |
| `frontend/` | Frontend (Harshitha) | Next.js app (added separately)       |
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

> Full setup instructions and the AI-usage disclosure are finalized in Phase 12
> (`IMPLEMENTATION.md`).
