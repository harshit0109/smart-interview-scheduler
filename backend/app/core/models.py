"""ORM models. See DB_DESIGN.md for the authoritative schema.

Phase 2 owns `users` + `calendar_connections` (the latter schema-only until
Phase 6). Phase 3 adds `interview_requests`, `interview_participants`,
`audit_logs`. Phase 4 adds `candidate_availability`, `availability_windows`.
Phase 6 adds `recommendation_runs`, `recommended_slots`.
"""

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


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


ROUND_TYPES = ("SCREENING", "TECHNICAL", "MANAGERIAL", "HR")
# Full state machine in DB_DESIGN.md; Phase 3 only routes into AWAITING_CANDIDATE_AVAILABILITY.
REQUEST_STATUSES = (
    "DRAFT",
    "AWAITING_CANDIDATE_AVAILABILITY",
    "READY_FOR_SCHEDULING",
    "RECOMMENDED",
    "BOOKED",
    "COMPLETED",
    "RESCHEDULING",
    "FAILED",
    "CANCELLED",
)
EDITABLE_STATUSES = frozenset({"DRAFT", "AWAITING_CANDIDATE_AVAILABILITY"})


class InterviewRequest(Base):
    __tablename__ = "interview_requests"
    __table_args__ = (
        CheckConstraint(
            "round_type IN ('SCREENING','TECHNICAL','MANAGERIAL','HR')",
            name="ck_interview_requests_round_type",
        ),
        CheckConstraint("duration_minutes > 0", name="ck_interview_requests_duration"),
        CheckConstraint(
            "status IN ('DRAFT','AWAITING_CANDIDATE_AVAILABILITY','READY_FOR_SCHEDULING',"
            "'RECOMMENDED','BOOKED','COMPLETED','RESCHEDULING','FAILED','CANCELLED')",
            name="ck_interview_requests_status",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    candidate_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    round_type: Mapped[str] = mapped_column(String(20), nullable=False)
    duration_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    buffer_minutes: Mapped[int] = mapped_column(Integer, nullable=False, server_default="15")
    # DB_DESIGN.md says VARCHAR(30) but 'AWAITING_CANDIDATE_AVAILABILITY' is 31 chars.
    status: Mapped[str] = mapped_column(
        String(40), nullable=False, server_default="DRAFT", index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    participants: Mapped[list["InterviewParticipant"]] = relationship(
        back_populates="request",
        cascade="all, delete-orphan",
        order_by="InterviewParticipant.role_in_interview",
    )


class InterviewParticipant(Base):
    __tablename__ = "interview_participants"
    __table_args__ = (
        UniqueConstraint(
            "interview_request_id", "user_id", name="uq_interview_participants_request_user"
        ),
        CheckConstraint(
            "role_in_interview IN ('PANELIST','CANDIDATE')",
            name="ck_interview_participants_role",
        ),
        CheckConstraint(
            "response_status IN ('PENDING','ACCEPTED','DECLINED')",
            name="ck_interview_participants_response_status",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    interview_request_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("interview_requests.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    role_in_interview: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="PANELIST"
    )
    response_status: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="PENDING"
    )

    request: Mapped["InterviewRequest"] = relationship(back_populates="participants")


class CandidateAvailability(Base):
    """One candidate submission event for a request (DB_DESIGN.md).

    MVP: exactly one row per request (the state gate enforces it); the schema
    allows more for the Post-MVP re-submission flow.
    """

    __tablename__ = "candidate_availability"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    interview_request_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("interview_requests.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    candidate_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    # Captured per submission — NOT read from users.timezone (requirements.md §13).
    timezone: Mapped[str] = mapped_column(String(64), nullable=False)
    submitted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    windows: Mapped[list["AvailabilityWindow"]] = relationship(
        back_populates="availability",
        cascade="all, delete-orphan",
        order_by="AvailabilityWindow.start_time",
    )


class AvailabilityWindow(Base):
    __tablename__ = "availability_windows"
    __table_args__ = (
        CheckConstraint("end_time > start_time", name="ck_availability_windows_order"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    candidate_availability_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("candidate_availability.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    start_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    availability: Mapped["CandidateAvailability"] = relationship(back_populates="windows")


class AuditLog(Base):
    """Append-only record of key state-changing actions (FR-037).

    Written opportunistically from MVP phases; the viewing endpoint is Post-MVP.
    """

    __tablename__ = "audit_logs"
    __table_args__ = (
        CheckConstraint(
            "actor_role IN ('ADMIN','PANELIST','CANDIDATE','SYSTEM')",
            name="ck_audit_logs_actor_role",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    actor_role: Mapped[str] = mapped_column(String(20), nullable=False)
    action: Mapped[str] = mapped_column(String(50), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(30), nullable=False)
    entity_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    audit_metadata: Mapped[dict] = mapped_column(
        "metadata", JSONB, nullable=False, server_default="{}"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class RecommendationRun(Base):
    """One invocation of the Scheduling Service → pure Engine for a request.

    Written only by the Scheduling Service via its repository — never the Engine.
    `input_snapshot` is the normalized engine input; it contains time zones,
    windows, busy blocks and constraints only — never OAuth tokens.
    """

    __tablename__ = "recommendation_runs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    interview_request_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("interview_requests.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    algorithm_version: Mapped[str] = mapped_column(String(20), nullable=False)
    input_snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False)

    slots: Mapped[list["RecommendedSlot"]] = relationship(
        back_populates="run",
        cascade="all, delete-orphan",
        order_by="RecommendedSlot.rank",
    )


class RecommendedSlot(Base):
    __tablename__ = "recommended_slots"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    recommendation_run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("recommendation_runs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    start_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    total_score: Mapped[Decimal] = mapped_column(Numeric(4, 3), nullable=False)
    score_breakdown: Mapped[dict] = mapped_column(JSONB, nullable=False)
    explanation: Mapped[str] = mapped_column(Text, nullable=False)
    rank: Mapped[int] = mapped_column(Integer, nullable=False)
    is_selected: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )

    run: Mapped["RecommendationRun"] = relationship(back_populates="slots")
