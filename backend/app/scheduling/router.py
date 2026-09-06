"""Recommendations route — a thin wrapper over the Scheduling Service."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.calendar.client import GoogleCalendarClient, get_calendar_client
from app.core.db import get_db
from app.core.deps import CurrentUser, admin_or_owning_candidate
from app.scheduling import schemas, service

router = APIRouter(prefix="/interviews/{request_id}", tags=["recommendations"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
ClientDep = Annotated[GoogleCalendarClient, Depends(get_calendar_client)]


@router.post(
    "/recommendations",
    response_model=schemas.RecommendationResponse,
    # ADMIN, or the request's own candidate (Post-MVP self-service, Phase 9 item 4).
    dependencies=[Depends(admin_or_owning_candidate())],
)
async def create_recommendations(
    request_id: uuid.UUID, user: CurrentUser, db: DbDep, client: ClientDep
) -> schemas.RecommendationResponse:
    return await service.generate(db, user, request_id, client)
