"""interview_events, reconciliation_tasks

Revision ID: 0005
Revises: 0004
Create Date: 2026-09-06
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_UUID = postgresql.UUID(as_uuid=True)
_GEN = sa.text("gen_random_uuid()")
_NOW = sa.text("now()")


def upgrade() -> None:
    op.create_table(
        "interview_events",
        sa.Column("id", _UUID, server_default=_GEN, primary_key=True),
        sa.Column("interview_request_id", _UUID, nullable=False),
        sa.Column("start_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("calendar_event_id", sa.String(255), nullable=False),
        sa.Column("meeting_link", sa.Text(), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="CONFIRMED"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_NOW),
        sa.ForeignKeyConstraint(
            ["interview_request_id"], ["interview_requests.id"], ondelete="CASCADE",
            name="fk_interview_events_request",
        ),
        sa.CheckConstraint(
            "status IN ('CONFIRMED','CANCELLED')", name="ck_interview_events_status"
        ),
    )
    op.create_index(
        "ix_interview_events_request_id", "interview_events", ["interview_request_id"]
    )
    op.create_index("ix_interview_events_start_time", "interview_events", ["start_time"])
    op.create_index("ix_interview_events_end_time", "interview_events", ["end_time"])
    # At most one CONFIRMED event per request — the DB-level double-booking guard.
    op.create_index(
        "uq_interview_events_one_confirmed",
        "interview_events",
        ["interview_request_id"],
        unique=True,
        postgresql_where=sa.text("status = 'CONFIRMED'"),
    )

    op.create_table(
        "reconciliation_tasks",
        sa.Column("id", _UUID, server_default=_GEN, primary_key=True),
        sa.Column("interview_event_id", _UUID, nullable=True),
        sa.Column("external_calendar_event_id", sa.String(255), nullable=False),
        sa.Column("reason", sa.String(50), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="OPEN"),
        sa.Column("metadata", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_NOW),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["interview_event_id"], ["interview_events.id"], ondelete="CASCADE",
            name="fk_reconciliation_tasks_event",
        ),
        sa.CheckConstraint(
            "status IN ('OPEN','RESOLVED')", name="ck_reconciliation_tasks_status"
        ),
    )
    op.create_index(
        "ix_reconciliation_tasks_status", "reconciliation_tasks", ["status"]
    )


def downgrade() -> None:
    op.drop_table("reconciliation_tasks")
    op.drop_table("interview_events")
