"""participant_invitations; interview_participants UNAVAILABLE; interview_requests.title

Revision ID: 0007
Revises: 0006
Create Date: 2026-09-06
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_UUID = postgresql.UUID(as_uuid=True)
_GEN = sa.text("gen_random_uuid()")
_NOW = sa.text("now()")

_RESPONSE_STATUS_OLD = "response_status IN ('PENDING','ACCEPTED','DECLINED')"
_RESPONSE_STATUS_NEW = "response_status IN ('PENDING','ACCEPTED','DECLINED','UNAVAILABLE')"


def upgrade() -> None:
    op.create_table(
        "participant_invitations",
        sa.Column("id", _UUID, server_default=_GEN, primary_key=True),
        sa.Column("interview_request_id", _UUID, nullable=False),
        sa.Column("user_id", _UUID, nullable=False),
        sa.Column("role", sa.String(20), nullable=False),
        # SHA-256 hex digest of the raw token. The raw token is NEVER stored.
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="PENDING"),
        sa.Column("requires_account_setup", sa.Boolean(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("send_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("delivery_status", sa.String(20), nullable=True),
        sa.Column("responded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("response_reason", sa.String(1000), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_NOW),
        sa.ForeignKeyConstraint(
            ["interview_request_id"], ["interview_requests.id"], ondelete="CASCADE",
            name="fk_participant_invitations_request",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_participant_invitations_user",
        ),
        sa.UniqueConstraint("token_hash", name="uq_participant_invitations_token_hash"),
        # One invitation row per participant per request; resend rotates the token in place.
        sa.UniqueConstraint(
            "interview_request_id", "user_id",
            name="uq_participant_invitations_request_user",
        ),
        sa.CheckConstraint(
            "role IN ('CANDIDATE','PANELIST')",
            name="ck_participant_invitations_role",
        ),
        sa.CheckConstraint(
            "status IN ('PENDING','ACCEPTED','DECLINED','UNAVAILABLE','EXPIRED')",
            name="ck_participant_invitations_status",
        ),
        # NULL until a delivery is attempted; a NULL passes this CHECK in Postgres.
        sa.CheckConstraint(
            "delivery_status IN ('SENT','FAILED','SIMULATED')",
            name="ck_participant_invitations_delivery_status",
        ),
    )
    op.create_index(
        "ix_participant_invitations_request_id",
        "participant_invitations",
        ["interview_request_id"],
    )
    op.create_index(
        "ix_participant_invitations_user_id",
        "participant_invitations",
        ["user_id"],
    )

    # Extend the participant response CHECK to allow a panelist's UNAVAILABLE.
    op.drop_constraint(
        "ck_interview_participants_response_status",
        "interview_participants",
        type_="check",
    )
    op.create_check_constraint(
        "ck_interview_participants_response_status",
        "interview_participants",
        _RESPONSE_STATUS_NEW,
    )

    # Job / Role selected when the admin creates the interview. Nullable — existing
    # POST /interviews stays backwards compatible.
    op.add_column(
        "interview_requests",
        sa.Column("title", sa.String(200), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("interview_requests", "title")

    op.drop_constraint(
        "ck_interview_participants_response_status",
        "interview_participants",
        type_="check",
    )
    op.create_check_constraint(
        "ck_interview_participants_response_status",
        "interview_participants",
        _RESPONSE_STATUS_OLD,
    )

    op.drop_table("participant_invitations")
