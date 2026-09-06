"""Calendar HTTP routes. Two OAuth flows are never conflated — see app/auth/."""

from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.calendar import schemas, service
from app.calendar.client import (
    CalendarAuthError,
    CalendarTransportError,
    GoogleCalendarClient,
    get_calendar_client,
)
from app.core.config import settings
from app.core.db import get_db
from app.core.deps import CurrentUser, require_role

router = APIRouter(prefix="/calendar", tags=["calendar"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
ClientDep = Annotated[GoogleCalendarClient, Depends(get_calendar_client)]


@router.post(
    "/connect",
    response_model=schemas.ConnectResponse,
    dependencies=[Depends(require_role("ADMIN", "PANELIST"))],
)
async def connect(user: CurrentUser, client: ClientDep) -> schemas.ConnectResponse:
    return schemas.ConnectResponse(authorization_url=service.start_connect(user, client))


@router.get("/callback")
async def callback(
    db: DbDep,
    client: ClientDep,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
) -> RedirectResponse:
    base = settings.frontend_base_url.rstrip("/")
    if error or not code or not state:
        return RedirectResponse(f"{base}/calendar/error", status_code=302)
    try:
        await service.complete_callback(db, code=code, state=state, client=client)
    except (service.CalendarStateError, CalendarAuthError, CalendarTransportError):
        return RedirectResponse(f"{base}/calendar/error", status_code=302)
    return RedirectResponse(f"{base}/calendar/connected", status_code=302)


@router.get(
    "/status",
    response_model=schemas.CalendarStatusResponse,
    dependencies=[Depends(require_role("ADMIN", "PANELIST"))],
)
async def status(user: CurrentUser, db: DbDep) -> schemas.CalendarStatusResponse:
    return await service.get_status(db, user)
