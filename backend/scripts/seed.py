"""Provision non-CANDIDATE accounts.

Public /auth/register only creates CANDIDATE users (decision C1, PROJECT_CONTEXT.md).
ADMIN and PANELIST accounts are created here.

    python -m scripts.seed

Idempotent: existing emails are skipped. Override the dev defaults with env vars
SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD / SEED_PANELIST_EMAIL / SEED_PANELIST_PASSWORD.
"""

import asyncio
import os

from app.auth import repository
from app.core.db import SessionLocal
from app.core.security import hash_password

_ACCOUNTS = [
    ("ADMIN", os.getenv("SEED_ADMIN_EMAIL", "admin@example.com"),
     os.getenv("SEED_ADMIN_PASSWORD", "admin-pw-1"), "Seed Admin"),
    ("PANELIST", os.getenv("SEED_PANELIST_EMAIL", "panelist@example.com"),
     os.getenv("SEED_PANELIST_PASSWORD", "panelist-pw-1"), "Seed Panelist"),
]


async def main() -> None:
    async with SessionLocal() as db:
        for role, email, password, name in _ACCOUNTS:
            if await repository.get_by_email(db, email):
                print(f"skip  {role:8} {email} (exists)")
                continue
            await repository.create(
                db, email=email, name=name, role=role,
                auth_provider="PASSWORD", password_hash=hash_password(password),
            )
            print(f"created {role:8} {email}")
        await db.commit()


if __name__ == "__main__":
    asyncio.run(main())
