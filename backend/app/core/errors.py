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


def _envelope(code: str, message: str, field_errors: dict | None, trace_id: str) -> dict:
    return {
        "error": {
            "code": code,
            "message": message,
            "field_errors": field_errors,
            "trace_id": trace_id,
        }
    }


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
