"""Google IDENTITY token verification — identity scopes only.

This module NEVER requests, inspects, or stores Calendar scopes or tokens
(CODING_GUIDELINES.md §OAuth Architecture). It verifies a Google ID token's
signature, `aud`, `iss` and `exp`, and returns the identity claims only.

Note (Phase 2 decision, see PROJECT_CONTEXT.md): API_DESIGN.md originally said to
inspect the token's `scope` claim; Google ID tokens carry no `scope` claim, so
the check is aud/iss/exp instead. Identity-only scope is enforced client-side.
"""

from dataclasses import dataclass

from google.auth import exceptions as google_auth_exceptions
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token

from app.core.config import settings
from app.core.errors import InvalidGoogleTokenError

_ISSUERS = {"accounts.google.com", "https://accounts.google.com"}


@dataclass(frozen=True)
class GoogleIdentity:
    email: str
    name: str


def verify_id_token(token: str) -> GoogleIdentity:
    if not settings.google_login_oauth_client_id:
        raise InvalidGoogleTokenError("Google login is not configured.")
    try:
        claims = google_id_token.verify_oauth2_token(
            token,
            google_requests.Request(),
            audience=settings.google_login_oauth_client_id,
        )
    except (ValueError, google_auth_exceptions.GoogleAuthError) as exc:
        raise InvalidGoogleTokenError() from exc

    if claims.get("iss") not in _ISSUERS:
        raise InvalidGoogleTokenError()
    if not claims.get("email") or not claims.get("email_verified"):
        raise InvalidGoogleTokenError("Google account email is not verified.")

    return GoogleIdentity(email=claims["email"], name=claims.get("name") or claims["email"])
