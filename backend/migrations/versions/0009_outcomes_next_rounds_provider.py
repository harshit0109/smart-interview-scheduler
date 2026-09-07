"""interview outcomes + next-round chain + event provider + candidate archive

Revision ID: 0009
Revises: 0008
Create Date: 2026-09-07

Additive only. No existing column is dropped or retyped; every new column is
nullable or has a server default, so existing rows and the existing
POST/PATCH/booking paths keep working unchanged.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # --- interview_events: which provider actually created the event ----------
    # 'GOOGLE'    = a real Google Calendar event (calendar_event_id from Google,
    #               meeting_link is a real Meet URL).
    # 'SIMULATED' = development booking made while Google Calendar OAuth is not
    #               configured. calendar_event_id is a local "sim-..." id and
    #               meeting_link is NULL — never a fake Google Meet URL.
    op.add_column(
        "interview_events",
        sa.Column(
            "provider", sa.String(20), nullable=False, server_default="GOOGLE"
        ),
    )
    op.create_check_constraint(
        "ck_interview_events_provider",
        "interview_events",
        "provider IN ('GOOGLE','SIMULATED')",
    )

    # --- interview_requests: outcome + multi-round chain ---------------------
    op.add_column(
        "interview_requests",
        sa.Column("outcome", sa.String(20), nullable=True),
    )
    op.add_column(
        "interview_requests",
        sa.Column("outcome_notes", sa.Text(), nullable=True),
    )
    op.add_column(
        "interview_requests",
        sa.Column(
            "round_number", sa.Integer(), nullable=False, server_default="1"
        ),
    )
    op.add_column(
        "interview_requests",
        sa.Column("parent_request_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_interview_requests_parent",
        "interview_requests",
        "interview_requests",
        ["parent_request_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_interview_requests_parent_request_id",
        "interview_requests",
        ["parent_request_id"],
    )
    op.create_check_constraint(
        "ck_interview_requests_outcome",
        "interview_requests",
        "outcome IS NULL OR outcome IN ('PASSED','REJECTED','NO_SHOW')",
    )

    # --- users: reversible archive for candidates leaving the pipeline -------
    op.add_column(
        "users",
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "archived_at")

    op.drop_constraint("ck_interview_requests_outcome", "interview_requests", type_="check")
    op.drop_index("ix_interview_requests_parent_request_id", "interview_requests")
    op.drop_constraint("fk_interview_requests_parent", "interview_requests", type_="foreignkey")
    op.drop_column("interview_requests", "parent_request_id")
    op.drop_column("interview_requests", "round_number")
    op.drop_column("interview_requests", "outcome_notes")
    op.drop_column("interview_requests", "outcome")

    op.drop_constraint("ck_interview_events_provider", "interview_events", type_="check")
    op.drop_column("interview_events", "provider")
