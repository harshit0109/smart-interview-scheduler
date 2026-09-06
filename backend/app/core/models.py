"""ORM models. See DB_DESIGN.md for the authoritative schema.

Phase 2 owns `users` and creates `calendar_connections` as a schema-only
placeholder (no code reads or writes it until Phase 6).
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("role IN ('ADMIN','PANELIST','CANDIDATE')", name="ck_users_role"),
        CheckConstraint(
            "auth_provider IN ('PASSWORD','GOOGLE')", name="ck_users_auth_provider"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    auth_provider: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="PASSWORD"
    )
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, server_default="UTC")
    token_version: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class CalendarConnection(Base):
    """Schema-only placeholder for Phase 2 — populated in Phase 6."""

    __tablename__ = "calendar_connections"
    __table_args__ = (
        UniqueConstraint("user_id", "provider", name="uq_calendar_connections_user_provider"),
        CheckConstraint(
            "status IN ('CONNECTED','EXPIRED','REVOKED','DISCONNECTED')",
            name="ck_calendar_connections_status",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    provider: Mapped[str] = mapped_column(String(20), nullable=False, server_default="GOOGLE")
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="DISCONNECTED", index=True
    )
    scopes_granted: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    access_token_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    refresh_token_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    token_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
