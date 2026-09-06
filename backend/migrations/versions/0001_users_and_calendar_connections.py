"""users and calendar_connections

Revision ID: 0001
Revises:
Create Date: 2026-09-06
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            primary_key=True,
        ),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("auth_provider", sa.String(20), nullable=False, server_default="PASSWORD"),
        sa.Column("timezone", sa.String(64), nullable=False, server_default="UTC"),
        sa.Column("token_version", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint("role IN ('ADMIN','PANELIST','CANDIDATE')", name="ck_users_role"),
        sa.CheckConstraint(
            "auth_provider IN ('PASSWORD','GOOGLE')", name="ck_users_auth_provider"
        ),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "calendar_connections",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            primary_key=True,
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("provider", sa.String(20), nullable=False, server_default="GOOGLE"),
        sa.Column("status", sa.String(20), nullable=False, server_default="DISCONNECTED"),
        sa.Column("scopes_granted", sa.Text(), nullable=False, server_default=""),
        sa.Column("access_token_encrypted", sa.Text(), nullable=True),
        sa.Column("refresh_token_encrypted", sa.Text(), nullable=True),
        sa.Column("token_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], ondelete="CASCADE",
            name="fk_calendar_connections_user_id",
        ),
        sa.UniqueConstraint(
            "user_id", "provider", name="uq_calendar_connections_user_provider"
        ),
        sa.CheckConstraint(
            "status IN ('CONNECTED','EXPIRED','REVOKED','DISCONNECTED')",
            name="ck_calendar_connections_status",
        ),
    )
    op.create_index(
        "ix_calendar_connections_user_id", "calendar_connections", ["user_id"]
    )
    op.create_index(
        "ix_calendar_connections_status", "calendar_connections", ["status"]
    )


def downgrade() -> None:
    op.drop_table("calendar_connections")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")
