"""interview_requests.company — hiring company/org for the interview

Revision ID: 0008
Revises: 0007
Create Date: 2026-09-07
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Nullable — existing POST /interviews stays backwards compatible, exactly
    # like `title` in migration 0007.
    op.add_column(
        "interview_requests",
        sa.Column("company", sa.String(200), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("interview_requests", "company")
