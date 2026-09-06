"""interview_requests, interview_participants, audit_logs

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-06
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_UUID = postgresql.UUID(as_uuid=True)
_GEN = sa.text("gen_random_uuid()")
_NOW = sa.text("now()")


def _created_at() -> sa.Column:
    return sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_NOW)


def upgrade() -> None:
    op.create_table(
        "interview_requests",
        sa.Column("id", _UUID, server_default=_GEN, primary_key=True),
        sa.Column("candidate_id", _UUID, nullable=False),
        sa.Column("created_by", _UUID, nullable=False),
        sa.Column("round_type", sa.String(20), nullable=False),
        sa.Column("duration_minutes", sa.Integer(), nullable=False),
        sa.Column("buffer_minutes", sa.Integer(), nullable=False, server_default="15"),
        # DB_DESIGN.md says VARCHAR(30) but 'AWAITING_CANDIDATE_AVAILABILITY' is 31 chars.
        sa.Column("status", sa.String(40), nullable=False, server_default="DRAFT"),
        _created_at(),
        sa.ForeignKeyConstraint(
            ["candidate_id"], ["users.id"], name="fk_interview_requests_candidate"
        ),
        sa.ForeignKeyConstraint(
            ["created_by"], ["users.id"], name="fk_interview_requests_created_by"
        ),
        sa.CheckConstraint(
            "round_type IN ('SCREENING','TECHNICAL','MANAGERIAL','HR')",
            name="ck_interview_requests_round_type",
        ),
        sa.CheckConstraint("duration_minutes > 0", name="ck_interview_requests_duration"),
        sa.CheckConstraint(
            "status IN ('DRAFT','AWAITING_CANDIDATE_AVAILABILITY','READY_FOR_SCHEDULING',"
            "'RECOMMENDED','BOOKED','COMPLETED','RESCHEDULING','FAILED','CANCELLED')",
            name="ck_interview_requests_status",
        ),
    )
    op.create_index("ix_interview_requests_candidate_id", "interview_requests", ["candidate_id"])
    op.create_index("ix_interview_requests_created_by", "interview_requests", ["created_by"])
    op.create_index("ix_interview_requests_status", "interview_requests", ["status"])

    op.create_table(
        "interview_participants",
        sa.Column("id", _UUID, server_default=_GEN, primary_key=True),
        sa.Column("interview_request_id", _UUID, nullable=False),
        sa.Column("user_id", _UUID, nullable=False),
        sa.Column(
            "role_in_interview", sa.String(20), nullable=False, server_default="PANELIST"
        ),
        sa.Column("response_status", sa.String(20), nullable=False, server_default="PENDING"),
        sa.ForeignKeyConstraint(
            ["interview_request_id"], ["interview_requests.id"], ondelete="CASCADE",
            name="fk_interview_participants_request",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_interview_participants_user"),
        sa.UniqueConstraint(
            "interview_request_id", "user_id", name="uq_interview_participants_request_user"
        ),
        sa.CheckConstraint(
            "role_in_interview IN ('PANELIST','CANDIDATE')",
            name="ck_interview_participants_role",
        ),
        sa.CheckConstraint(
            "response_status IN ('PENDING','ACCEPTED','DECLINED')",
            name="ck_interview_participants_response_status",
        ),
    )
    op.create_index(
        "ix_interview_participants_request_id",
        "interview_participants",
        ["interview_request_id"],
    )
    op.create_index(
        "ix_interview_participants_user_id", "interview_participants", ["user_id"]
    )

    op.create_table(
        "audit_logs",
        sa.Column("id", _UUID, server_default=_GEN, primary_key=True),
        sa.Column("actor_id", _UUID, nullable=True),
        sa.Column("actor_role", sa.String(20), nullable=False),
        sa.Column("action", sa.String(50), nullable=False),
        sa.Column("entity_type", sa.String(30), nullable=False),
        sa.Column("entity_id", _UUID, nullable=False),
        sa.Column("metadata", postgresql.JSONB(), nullable=False, server_default="{}"),
        _created_at(),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"], name="fk_audit_logs_actor"),
        sa.CheckConstraint(
            "actor_role IN ('ADMIN','PANELIST','CANDIDATE','SYSTEM')",
            name="ck_audit_logs_actor_role",
        ),
    )
    op.create_index("ix_audit_logs_entity", "audit_logs", ["entity_type", "entity_id"])
    op.create_index("ix_audit_logs_created_at", "audit_logs", ["created_at"])


def downgrade() -> None:
    op.drop_table("audit_logs")
    op.drop_table("interview_participants")
    op.drop_table("interview_requests")
