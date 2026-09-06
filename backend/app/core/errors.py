"""Typed application errors + the single global exception handler.

Every AppError subclass maps to exactly one documented error `code`
(API_DESIGN.md §Standard Error Format). No raw stack trace ever reaches a client.
"""

import logging
import uuid

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)


class AppError(Exception):
    status_code = 500
    code = "INTERNAL_ERROR"
    message = "Something went wrong."

    def __init__(self, message: str | None = None, *, field_errors: dict | None = None):
        super().__init__(message or self.message)
        if message:
            self.message = message
        self.field_errors = field_errors


class EmailAlreadyRegisteredError(AppError):
    status_code = 409
    code = "EMAIL_ALREADY_REGISTERED"
    message = "An account with this email already exists."


class InvalidCredentialsError(AppError):
    status_code = 401
    code = "INVALID_CREDENTIALS"
    message = "Incorrect email or password."


class InvalidGoogleTokenError(AppError):
    status_code = 401
    code = "INVALID_GOOGLE_TOKEN"
    message = "The Google token could not be verified."


class RefreshTokenInvalidError(AppError):
    status_code = 401
    code = "REFRESH_TOKEN_INVALID"
    message = "The refresh token is invalid or expired."


class RefreshTokenRevokedError(AppError):
    status_code = 401
    code = "REFRESH_TOKEN_REVOKED"
    message = "The refresh token has been revoked."


class NotAuthenticatedError(AppError):
    status_code = 401
    code = "NOT_AUTHENTICATED"
    message = "Authentication is required."


class ForbiddenError(AppError):
    status_code = 403
    code = "FORBIDDEN"
    message = "Your role does not permit this action."


class NotFoundError(AppError):
    status_code = 404
    code = "NOT_FOUND"
    message = "Resource not found."


class InvalidParticipantError(AppError):
    status_code = 422
    code = "INVALID_PARTICIPANT"
    message = "A referenced participant is missing or has the wrong role."


class RequestLockedForEditingError(AppError):
    status_code = 409
    code = "REQUEST_LOCKED_FOR_EDITING"
    message = "This interview request can no longer be edited in its current state."


class RequestNotAwaitingAvailabilityError(AppError):
    status_code = 409
    code = "REQUEST_NOT_AWAITING_AVAILABILITY"
    message = "This interview request is not awaiting candidate availability."


class NotReadyForSchedulingError(AppError):
    status_code = 409
    code = "NOT_READY_FOR_SCHEDULING"
    message = "This interview request is not ready for scheduling."


class PanelistCalendarNotConnectedError(AppError):
    status_code = 424
    code = "PANELIST_CALENDAR_NOT_CONNECTED"
    message = "A required panelist has not connected their Google Calendar."


class CalendarConnectionRevokedError(AppError):
    status_code = 424
    code = "CALENDAR_CONNECTION_REVOKED"
    message = "A required panelist's Google Calendar connection has been revoked."


class CalendarConnectionExpiredError(AppError):
    status_code = 424
    code = "CALENDAR_CONNECTION_EXPIRED"
    message = "A required panelist's Google Calendar connection has expired."


class NoCommonAvailabilityError(AppError):
    status_code = 422
    code = "NO_COMMON_AVAILABILITY"
    message = "No time slot works for every participant."


class CalendarSyncFailedError(AppError):
    status_code = 502
    code = "CALENDAR_SYNC_FAILED"
    message = "Could not retrieve calendar availability from Google. Please retry."


class SlotNoLongerAvailableError(AppError):
    status_code = 409
    code = "SLOT_NO_LONGER_AVAILABLE"
    message = "This slot is no longer available. Please choose another."


class CalendarEventCreationFailedError(AppError):
    status_code = 502
    code = "CALENDAR_EVENT_CREATION_FAILED"
    message = "The Google Calendar event could not be created. The booking did not complete."


class BookingPersistenceFailedError(AppError):
    status_code = 500
    code = "BOOKING_PERSISTENCE_FAILED"
    message = "The booking could not be saved and did not complete."


class RateLimitedError(AppError):
    status_code = 429
    code = "RATE_LIMITED"
    message = "Too many requests. Please slow down and try again shortly."


class NotBookedError(AppError):
    status_code = 409
    code = "NOT_BOOKED"
    message = "This interview request has no booked slot to reschedule."


class RequestAlreadyTerminalError(AppError):
    status_code = 409
    code = "REQUEST_ALREADY_TERMINAL"
    message = "This interview request is already cancelled or completed."


class RoleConflictError(AppError):
    status_code = 422
    code = "ROLE_CONFLICT"
    message = "An account with this email already exists with a different role."


class AdminAlreadyExistsError(AppError):
    status_code = 409
    code = "ADMIN_ALREADY_EXISTS"
    message = "An administrator account already exists. Bootstrap is disabled."


class InvitationNotFoundError(AppError):
    status_code = 404
    code = "INVITATION_NOT_FOUND"
    message = "This invitation link is invalid."


class InvitationExpiredError(AppError):
    status_code = 409
    code = "INVITATION_EXPIRED"
    message = "This invitation has expired. Ask the recruiter to resend it."


class InvitationAlreadyRespondedError(AppError):
    status_code = 409
    code = "INVITATION_ALREADY_RESPONDED"
    message = "This invitation has already been responded to."


class AccountAlreadyClaimedError(AppError):
    status_code = 409
    code = "ACCOUNT_ALREADY_CLAIMED"
    message = "This account already has a password set. Please log in instead."


class AccountSetupNotRequiredError(AppError):
    status_code = 409
    code = "ACCOUNT_SETUP_NOT_REQUIRED"
    message = "This invitation does not require account setup."


def _envelope(code: str, message: str, field_errors: dict | None, trace_id: str) -> dict:
    return {
        "error": {
            "code": code,
            "message": message,
            "field_errors": field_errors,
            "trace_id": trace_id,
        }
    }


def error_body(
    code: str, message: str, *, field_errors: dict | None = None, trace_id: str | None = None
) -> dict:
    """Public helper for code that builds an error response outside the exception
    handlers (e.g. the rate-limit middleware, which runs before routing)."""
    return _envelope(code, message, field_errors, trace_id or uuid.uuid4().hex[:8])


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError):
        trace_id = uuid.uuid4().hex[:8]
        if exc.status_code >= 500:
            logger.error("app_error %s [%s]: %s", exc.code, trace_id, exc, exc_info=exc)
        return JSONResponse(
            status_code=exc.status_code,
            content=_envelope(exc.code, exc.message, exc.field_errors, trace_id),
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError):
        trace_id = uuid.uuid4().hex[:8]
        field_errors: dict[str, str] = {}
        for err in exc.errors():
            loc = ".".join(str(p) for p in err["loc"] if p != "body")
            field_errors[loc or "__root__"] = err["msg"]
        return JSONResponse(
            status_code=422,
            content=_envelope(
                "VALIDATION_ERROR", "Request validation failed.", field_errors, trace_id
            ),
        )

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception):
        trace_id = uuid.uuid4().hex[:8]
        logger.error("unhandled_error [%s]", trace_id, exc_info=exc)
        return JSONResponse(
            status_code=500,
            content=_envelope("INTERNAL_ERROR", "Something went wrong.", None, trace_id),
        )
