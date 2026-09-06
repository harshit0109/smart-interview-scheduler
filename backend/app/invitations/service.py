"""Invitation issuance, public token resolution, response, and account claim.

Raw tokens are generated here and exposed exactly twice: in the issuance API
response (to the authenticated ADMIN, for the copy-link UX) and in the body of
the outbound email. Only SHA-256(token) is ever persisted, and neither the
token nor the email body is ever logged or written to `audit_logs` — see
`_send_invite_email` and the `test_no_raw_token_leaks` test.

Responding to an invitation and claiming an account are independent actions
(PROJECT_CONTEXT.md invitation-phase decision): neither calls into
`app.interviews.lifecycle` — a token-based response only updates
`participant_invitations` + mirrors `interview_participants.response_status`.
Booking/scheduling side effects from a decline remain the authenticated
Phase 9 lifecycle endpoints, untouched by this module.
"""

import hashlib
import logging
import secrets
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.schemas import TokenPair, UserSummary
from app.booking import repository as booking_repository
from app.core.audit import record_audit
from app.core.config import settings
from app.core.errors import (
    AccountAlreadyClaimedError,
    AccountSetupNotRequiredError,
    InvalidParticipantError,
    InvitationAlreadyRespondedError,
    InvitationExpiredError,
    InvitationNotFoundError,
    NotFoundError,
)
from app.core.models import InterviewRequest, ParticipantInvitation, User
from app.core.security import create_access_token, create_refresh_token, hash_password
from app.interviews import repository as interviews_repository
from app.invitations import repository, schemas
from app.notifications.client import EmailMessage, SendGridClient

logger = logging.getLogger("app.invitations")


def _hash(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode()).hexdigest()


def _invite_url(raw_token: str) -> str:
    return f"{settings.frontend_base_url}/invite/{raw_token}"


async def _send_invite_email(
    client: SendGridClient, *, user: User, request: InterviewRequest, raw_token: str
) -> str:
    """SENT / SIMULATED / FAILED, mirroring notifications/service.py's
    _dispatch — except the SIMULATED path here never logs the message body,
    because that body contains the raw invitation link."""
    label = request.title or f"{request.round_type.title()} round"
    subject = f"Interview invitation — {label}"
    body = (
        f"You've been invited to an interview ({label}, "
        f"{request.duration_minutes} minutes).\n\n"
        f"Respond here: {_invite_url(raw_token)}\n"
    )
    msg = EmailMessage(to=user.email, cc=[], subject=subject, text_body=body)
    if not client.configured:
        logger.info("invitation.simulated to=%s subject=%r", msg.to, msg.subject)
        return "SIMULATED"
    try:
        await client.send(msg)
        logger.info("invitation.sent to=%s", msg.to)
        return "SENT"
    except Exception as exc:  # noqa: BLE001 - a send failure must not block issuance
        logger.warning("invitation.failed to=%s: %s", msg.to, type(exc).__name__)
        return "FAILED"


_TERMINAL_RESPONSE_STATUSES = {"ACCEPTED", "DECLINED", "UNAVAILABLE"}


async def issue_for_request(
    db: AsyncSession, actor: User, request_id: uuid.UUID, *, client: SendGridClient
) -> list[schemas.InvitationSummary]:
    """ADMIN-controlled, explicit — never called from interview creation.
    One invitation per current participant (candidate + every panelist); a
    participant with no invitation yet, or one still PENDING/EXPIRED, gets a
    fresh token (issue or resend). A participant who already ACCEPTED /
    DECLINED / UNAVAILABLE is left untouched — resending must never erase a
    real response by resetting it back to PENDING. Reopening a completed
    response is a deliberate future admin action, not implicit in "resend"."""
    request = await interviews_repository.get(db, request_id)
    if request is None:
        raise NotFoundError("interview request not found")
    parts = await booking_repository.participants_with_users(db, request_id)

    expires_at = datetime.now(UTC) + timedelta(hours=settings.invitation_ttl_hours)
    out: list[schemas.InvitationSummary] = []

    for participant, user in parts:
        existing = await repository.get_for_request_user(db, request_id, user.id)
        if existing is not None and existing.status in _TERMINAL_RESPONSE_STATUSES:
            continue  # already responded — resend must not reopen or reset this

        raw_token = secrets.token_urlsafe(32)
        token_hash = _hash(raw_token)
        is_resend = existing is not None
        row = repository.apply(
            existing,
            request_id=request_id,
            user_id=user.id,
            role=participant.role_in_interview,
            token_hash=token_hash,
            requires_account_setup=user.password_hash is None,
            expires_at=expires_at,
        )
        if not is_resend:
            db.add(row)
        try:
            await db.flush()
        except IntegrityError:
            # Concurrent issuance for the same participant (e.g. a double-click)
            # lost the race on the unique (request_id, user_id) constraint —
            # reload the row a second admin just created and rotate that one.
            await db.rollback()
            existing = await repository.get_for_request_user(db, request_id, user.id)
            if existing is None:
                raise
            is_resend = True
            row = repository.apply(
                existing,
                request_id=request_id,
                user_id=user.id,
                role=participant.role_in_interview,
                token_hash=token_hash,
                requires_account_setup=user.password_hash is None,
                expires_at=expires_at,
            )
            await db.flush()

        delivery_status = await _send_invite_email(
            client, user=user, request=request, raw_token=raw_token
        )
        row.delivery_status = delivery_status
        row.sent_at = datetime.now(UTC)
        row.send_count += 1

        await record_audit(
            db,
            actor_id=actor.id,
            actor_role=actor.role,
            action="INVITATION_ISSUED",
            entity_type="participant_invitation",
            entity_id=row.id,
            metadata={
                "user_id": str(user.id),
                "role": participant.role_in_interview,
                "resent": is_resend,
                "delivery_status": delivery_status,
            },
        )
        out.append(
            schemas.InvitationSummary(
                id=row.id,
                user_id=user.id,
                role=participant.role_in_interview,
                status=row.status,
                requires_account_setup=row.requires_account_setup,
                delivery_status=row.delivery_status,
                send_count=row.send_count,
                expires_at=row.expires_at,
                invite_url=_invite_url(raw_token),
            )
        )

    await db.commit()
    logger.info("invitations.issued request_id=%s count=%d", request_id, len(out))
    return out


async def list_for_request(
    db: AsyncSession, request_id: uuid.UUID
) -> list[schemas.InvitationOut]:
    request = await interviews_repository.get(db, request_id)
    if request is None:
        raise NotFoundError("interview request not found")
    rows = await repository.list_for_request(db, request_id)
    return [
        schemas.InvitationOut(
            id=r.id,
            user_id=r.user_id,
            role=r.role,
            status=r.status,
            requires_account_setup=r.requires_account_setup,
            delivery_status=r.delivery_status,
            send_count=r.send_count,
            expires_at=r.expires_at,
            responded_at=r.responded_at,
        )
        for r in rows
    ]


async def _resolve_active(db: AsyncSession, raw_token: str) -> ParticipantInvitation:
    row = await repository.get_by_token_hash(db, _hash(raw_token))
    if row is None:
        raise InvitationNotFoundError()
    if row.status == "PENDING" and row.expires_at <= datetime.now(UTC):
        row.status = "EXPIRED"
        await db.commit()
    return row


async def _public_out(db: AsyncSession, row: ParticipantInvitation) -> schemas.InvitationPublicOut:
    request = await db.get(InterviewRequest, row.interview_request_id)
    user = await db.get(User, row.user_id)
    return schemas.InvitationPublicOut(
        role=row.role,
        status=row.status,
        requires_account_setup=row.requires_account_setup,
        account_claimed=user.password_hash is not None,
        interview_title=request.title,
        round_type=request.round_type,
        duration_minutes=request.duration_minutes,
    )


async def get_by_token(db: AsyncSession, raw_token: str) -> schemas.InvitationPublicOut:
    row = await _resolve_active(db, raw_token)
    return await _public_out(db, row)


async def respond(
    db: AsyncSession, raw_token: str, response: str, reason: str | None
) -> schemas.InvitationPublicOut:
    row = await _resolve_active(db, raw_token)
    if row.status == "EXPIRED":
        raise InvitationExpiredError()
    if row.status != "PENDING":
        raise InvitationAlreadyRespondedError()
    if response == "UNAVAILABLE" and row.role != "PANELIST":
        raise InvalidParticipantError("only a panelist invitation can be marked UNAVAILABLE")

    row.status = response
    row.responded_at = datetime.now(UTC)
    row.response_reason = reason

    participant = await repository.get_participant(db, row.interview_request_id, row.user_id)
    if participant is not None:
        participant.response_status = response

    await record_audit(
        db,
        actor_id=None,
        actor_role=row.role,
        action="INVITATION_RESPONDED",
        entity_type="participant_invitation",
        entity_id=row.id,
        metadata={"response": response, "role": row.role},
    )
    await db.commit()
    logger.info("invitations.responded invitation_id=%s response=%s", row.id, response)
    return await _public_out(db, row)


async def claim_account(db: AsyncSession, raw_token: str, password: str) -> TokenPair:
    row = await _resolve_active(db, raw_token)
    if row.status == "EXPIRED":
        raise InvitationExpiredError()
    if not row.requires_account_setup:
        raise AccountSetupNotRequiredError()

    user = await db.get(User, row.user_id)
    if user is None:
        raise InvitationNotFoundError()
    if user.password_hash is not None:
        raise AccountAlreadyClaimedError()

    user.password_hash = hash_password(password)
    await record_audit(
        db,
        actor_id=user.id,
        actor_role=user.role,
        action="ACCOUNT_CLAIMED",
        entity_type="user",
        entity_id=user.id,
        metadata={"email": user.email},
    )
    await db.commit()
    logger.info("invitations.account_claimed user_id=%s", user.id)

    return TokenPair(
        access_token=create_access_token(user.id, user.role),
        refresh_token=create_refresh_token(user.id, user.token_version),
        user=UserSummary(id=user.id, role=user.role),
    )
