"""notification_logs

Revision ID: 0006
Revises: 0005
Create Date: 2026-09-06
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    op.create_table(
        "notification_logs",
        sa.Column(
            "id", _UUID, server_default=sa.text("gen_random_uuid()"), primary_key=True
        ),
        sa.Column("interview_event_id", _UUID, nullable=False),
        sa.Column("channel", sa.String(10), nullable=False),
        sa.Column("notification_type", sa.String(20), nullable=False),
        sa.Column("recipient", sa.String(255), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column(
            "sent_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
        ),
        sa.ForeignKeyConstraint(
            ["interview_event_id"], ["interview_events.id"], ondelete="CASCADE",
            name="fk_notification_logs_event",
        ),
        sa.CheckConstraint("channel IN ('EMAIL')", name="ck_notification_logs_channel"),
        sa.CheckConstraint(
            "notification_type IN "
            "('CONFIRMATION','REMINDER','DECLINE','CANCELLATION','RESCHEDULE')",
            name="ck_notification_logs_type",
        ),
        sa.CheckConstraint(
            "status IN ('SENT','FAILED','SIMULATED')", name="ck_notification_logs_status"
        ),
    )
    op.create_index(
        "ix_notification_logs_event_id", "notification_logs", ["interview_event_id"]
    )


def downgrade() -> None:
    op.drop_table("notification_logs")
