"""Two route groups:

- `router` — ADMIN-only, nested under an interview request (issue/resend + list).
- `public_router` — unauthenticated, token-resolved (GET/respond/claim-account).
  Strictly rate-limited (app/core/ratelimit.py); the token itself is the only
  credential these three routes accept.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.schemas import TokenPair
from app.core.db import get_db
from app.core.deps import CurrentUser, require_role
from app.invitations import schemas, service
from app.notifications.client import SendGridClient, get_sendgrid_client

DbDep = Annotated[AsyncSession, Depends(get_db)]
SendGridDep = Annotated[SendGridClient, Depends(get_sendgrid_client)]

router = APIRouter(prefix="/interviews/{request_id}/invitations", tags=["invitations"])


@router.post(
    "",
    response_model=list[schemas.InvitationSummary],
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_role("ADMIN"))],
)
async def issue_invitations(
    request_id: uuid.UUID, user: CurrentUser, db: DbDep, sendgrid: SendGridDep
) -> list[schemas.InvitationSummary]:
    return await service.issue_for_request(db, user, request_id, client=sendgrid)


@router.get(
    "",
    response_model=list[schemas.InvitationOut],
    dependencies=[Depends(require_role("ADMIN"))],
)
async def list_invitations(request_id: uuid.UUID, db: DbDep) -> list[schemas.InvitationOut]:
    return await service.list_for_request(db, request_id)


public_router = APIRouter(prefix="/invitations", tags=["invitations"])


@public_router.get("/{token}", response_model=schemas.InvitationPublicOut)
async def get_invitation(token: str, db: DbDep) -> schemas.InvitationPublicOut:
    return await service.get_by_token(db, token)


@public_router.post("/{token}/respond", response_model=schemas.InvitationPublicOut)
async def respond_invitation(
    token: str, data: schemas.RespondRequest, db: DbDep
) -> schemas.InvitationPublicOut:
    return await service.respond(db, token, data.response, data.reason)


@public_router.post("/{token}/claim-account", response_model=TokenPair)
async def claim_account(
    token: str, data: schemas.ClaimAccountRequest, db: DbDep
) -> TokenPair:
    return await service.claim_account(db, token, data.password)
