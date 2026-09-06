"""recommendation_runs, recommended_slots

Revision ID: 0004
Revises: 0003
Create Date: 2026-09-06
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_UUID = postgresql.UUID(as_uuid=True)
_GEN = sa.text("gen_random_uuid()")


def upgrade() -> None:
    op.create_table(
        "recommendation_runs",
        sa.Column("id", _UUID, server_default=_GEN, primary_key=True),
        sa.Column("interview_request_id", _UUID, nullable=False),
        sa.Column(
            "generated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("algorithm_version", sa.String(20), nullable=False),
        sa.Column("input_snapshot", postgresql.JSONB(), nullable=False),
        sa.ForeignKeyConstraint(
            ["interview_request_id"], ["interview_requests.id"], ondelete="CASCADE",
            name="fk_recommendation_runs_request",
        ),
    )
    op.create_index(
        "ix_recommendation_runs_request_id",
        "recommendation_runs",
        ["interview_request_id"],
    )

    op.create_table(
        "recommended_slots",
        sa.Column("id", _UUID, server_default=_GEN, primary_key=True),
        sa.Column("recommendation_run_id", _UUID, nullable=False),
        sa.Column("start_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("total_score", sa.Numeric(4, 3), nullable=False),
        sa.Column("score_breakdown", postgresql.JSONB(), nullable=False),
        sa.Column("explanation", sa.Text(), nullable=False),
        sa.Column("rank", sa.Integer(), nullable=False),
        sa.Column("is_selected", sa.Boolean(), nullable=False, server_default="false"),
        sa.ForeignKeyConstraint(
            ["recommendation_run_id"], ["recommendation_runs.id"], ondelete="CASCADE",
            name="fk_recommended_slots_run",
        ),
    )
    op.create_index(
        "ix_recommended_slots_run_id", "recommended_slots", ["recommendation_run_id"]
    )


def downgrade() -> None:
    op.drop_table("recommended_slots")
    op.drop_table("recommendation_runs")
