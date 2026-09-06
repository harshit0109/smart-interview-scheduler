"""candidate_availability, availability_windows

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-06
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_UUID = postgresql.UUID(as_uuid=True)
_GEN = sa.text("gen_random_uuid()")


def upgrade() -> None:
    op.create_table(
        "candidate_availability",
        sa.Column("id", _UUID, server_default=_GEN, primary_key=True),
        sa.Column("interview_request_id", _UUID, nullable=False),
        sa.Column("candidate_id", _UUID, nullable=False),
        sa.Column("timezone", sa.String(64), nullable=False),
        sa.Column(
            "submitted_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["interview_request_id"], ["interview_requests.id"], ondelete="CASCADE",
            name="fk_candidate_availability_request",
        ),
        sa.ForeignKeyConstraint(
            ["candidate_id"], ["users.id"], name="fk_candidate_availability_candidate"
        ),
    )
    op.create_index(
        "ix_candidate_availability_request_id",
        "candidate_availability",
        ["interview_request_id"],
    )

    op.create_table(
        "availability_windows",
        sa.Column("id", _UUID, server_default=_GEN, primary_key=True),
        sa.Column("candidate_availability_id", _UUID, nullable=False),
        sa.Column("start_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_time", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["candidate_availability_id"], ["candidate_availability.id"], ondelete="CASCADE",
            name="fk_availability_windows_availability",
        ),
        sa.CheckConstraint("end_time > start_time", name="ck_availability_windows_order"),
    )
    op.create_index(
        "ix_availability_windows_availability_id",
        "availability_windows",
        ["candidate_availability_id"],
    )


def downgrade() -> None:
    op.drop_table("availability_windows")
    op.drop_table("candidate_availability")
