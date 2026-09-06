"""The single Google HTTP seam: auth-URL building, token exchange/refresh, freeBusy,
event create/delete.

Everything network-facing for Calendar lives here so the rest of the codebase —
and every test — can substitute a fake with the same method surface. Access
tokens pass through as function arguments and are never logged.
"""

import asyncio
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from urllib.parse import urlencode

import httpx

from app.core.config import settings

_AUTH_URI = "https://accounts.google.com/o/oauth2/v2/auth"
_TOKEN_URI = "https://oauth2.googleapis.com/token"
_FREEBUSY_URI = "https://www.googleapis.com/calendar/v3/freeBusy"
_EVENTS_URI = "https://www.googleapis.com/calendar/v3/calendars/primary/events"

CALENDAR_SCOPES = (
    "https://www.googleapis.com/auth/calendar.freebusy",
    "https://www.googleapis.com/auth/calendar.events",
)

_RETRY_ATTEMPTS = 3
_BACKOFF_SECONDS = (0.5, 1.0, 2.0)  # patched to zeros in tests
_TIMEOUT = httpx.Timeout(10.0)


class CalendarAuthError(Exception):
    """Google rejected the grant itself (invalid_grant / 401) — the connection is dead."""


class CalendarTransportError(Exception):
    """Network / 5xx / 429 failure that survived all retries."""


@dataclass(frozen=True)
class TokenBundle:
    access_token: str
    refresh_token: str | None
    expires_in: int
    scope: str


@dataclass(frozen=True)
class BusyInterval:
    start: datetime
    end: datetime


@dataclass(frozen=True)
class CalendarEvent:
    event_id: str
    meeting_link: str | None
    html_link: str | None


class GoogleCalendarClient:
    def __init__(
        self,
        *,
        client_id: str,
        client_secret: str,
        redirect_uri: str,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self._client_id = client_id
        self._client_secret = client_secret
        self._redirect_uri = redirect_uri
        self._transport = transport  # tests inject httpx.MockTransport

    # ---------------------------------------------------------------- auth url --

    def authorization_url(self, state: str) -> str:
        params = {
            "client_id": self._client_id,
            "redirect_uri": self._redirect_uri,
            "response_type": "code",
            "scope": " ".join(CALENDAR_SCOPES),
            "access_type": "offline",
            "prompt": "consent",
            "include_granted_scopes": "false",
            "state": state,
        }
        return f"{_AUTH_URI}?{urlencode(params)}"

    # --------------------------------------------------------------- token ops --

    async def exchange_code(self, code: str) -> TokenBundle:
        return await self._token_request(
            {
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": self._redirect_uri,
            }
        )

    async def refresh(self, refresh_token: str) -> TokenBundle:
        bundle = await self._token_request(
            {"grant_type": "refresh_token", "refresh_token": refresh_token}
        )
        # Google omits refresh_token on a refresh; keep the caller's existing one.
        return bundle

    async def _token_request(self, form: dict[str, str]) -> TokenBundle:
        payload = {
            **form,
            "client_id": self._client_id,
            "client_secret": self._client_secret,
        }
        resp = await self._post(_TOKEN_URI, data=payload)
        body = resp.json()
        return TokenBundle(
            access_token=body["access_token"],
            refresh_token=body.get("refresh_token"),
            expires_in=int(body.get("expires_in", 3600)),
            scope=body.get("scope", ""),
        )

    # ----------------------------------------------------------------- freebusy -

    async def free_busy(
        self, access_token: str, time_min: datetime, time_max: datetime
    ) -> list[BusyInterval]:
        resp = await self._post(
            _FREEBUSY_URI,
            json={
                "timeMin": time_min.isoformat(),
                "timeMax": time_max.isoformat(),
                "items": [{"id": "primary"}],
            },
            headers={"Authorization": f"Bearer {access_token}"},
        )
        body = resp.json()
        cal = body.get("calendars", {}).get("primary", {})
        if cal.get("errors"):
            raise CalendarTransportError(f"freeBusy returned errors: {cal['errors']}")
        out: list[BusyInterval] = []
        for block in cal.get("busy", []):
            out.append(
                BusyInterval(
                    start=datetime.fromisoformat(block["start"].replace("Z", "+00:00")),
                    end=datetime.fromisoformat(block["end"].replace("Z", "+00:00")),
                )
            )
        return out

    # -------------------------------------------------------------- calendar ops -

    async def create_event(
        self,
        access_token: str,
        *,
        summary: str,
        description: str,
        start: datetime,
        end: datetime,
        attendee_emails: list[str],
    ) -> CalendarEvent:
        request_id = uuid.uuid4().hex
        resp = await self._request(
            "POST",
            f"{_EVENTS_URI}?conferenceDataVersion=1&sendUpdates=all",
            json={
                "summary": summary,
                "description": description,
                "start": {"dateTime": start.astimezone(UTC).isoformat()},
                "end": {"dateTime": end.astimezone(UTC).isoformat()},
                "attendees": [{"email": e} for e in attendee_emails],
                "conferenceData": {
                    "createRequest": {
                        "requestId": request_id,
                        "conferenceSolutionKey": {"type": "hangoutsMeet"},
                    }
                },
            },
            headers={"Authorization": f"Bearer {access_token}"},
        )
        body = resp.json()
        link = body.get("hangoutLink")
        if not link:
            for ep in body.get("conferenceData", {}).get("entryPoints", []):
                if ep.get("entryPointType") == "video" and ep.get("uri"):
                    link = ep["uri"]
                    break
        return CalendarEvent(
            event_id=body["id"], meeting_link=link, html_link=body.get("htmlLink")
        )

    async def delete_event(self, access_token: str, event_id: str) -> None:
        # 404 / 410 => the event is already gone; treat as a successful delete.
        await self._request(
            "DELETE",
            f"{_EVENTS_URI}/{event_id}?sendUpdates=all",
            headers={"Authorization": f"Bearer {access_token}"},
            ok_statuses=(404, 410),
        )

    # ------------------------------------------------------------ retry wrapper -

    async def _post(
        self,
        url: str,
        *,
        data: dict | None = None,
        json: dict | None = None,
        headers: dict | None = None,
    ) -> httpx.Response:
        return await self._request("POST", url, data=data, json=json, headers=headers)

    async def _request(
        self,
        method: str,
        url: str,
        *,
        data: dict | None = None,
        json: dict | None = None,
        headers: dict | None = None,
        ok_statuses: tuple[int, ...] = (),
    ) -> httpx.Response:
        last_exc: Exception | None = None
        for attempt in range(_RETRY_ATTEMPTS):
            try:
                async with httpx.AsyncClient(
                    timeout=_TIMEOUT, transport=self._transport
                ) as http:
                    resp = await http.request(
                        method, url, data=data, json=json, headers=headers
                    )
            except (httpx.TransportError, httpx.TimeoutException) as exc:
                last_exc = exc
            else:
                if resp.status_code < 400 or resp.status_code in ok_statuses:
                    return resp
                if resp.status_code in (400, 401):
                    body = _safe_json(resp)
                    if resp.status_code == 401 or body.get("error") in (
                        "invalid_grant",
                        "invalid_client",
                        "unauthorized_client",
                    ):
                        raise CalendarAuthError(body.get("error", f"HTTP {resp.status_code}"))
                    raise CalendarTransportError(f"HTTP {resp.status_code}: {body.get('error')}")
                if resp.status_code not in (429,) and resp.status_code < 500:
                    raise CalendarTransportError(f"HTTP {resp.status_code}")
                last_exc = CalendarTransportError(f"HTTP {resp.status_code}")

            if attempt + 1 < _RETRY_ATTEMPTS:
                await asyncio.sleep(_BACKOFF_SECONDS[attempt])

        raise CalendarTransportError(str(last_exc) if last_exc else "request failed")


def _safe_json(resp: httpx.Response) -> dict:
    try:
        return resp.json()
    except ValueError:
        return {}


def get_calendar_client() -> GoogleCalendarClient:
    """FastAPI dependency — overridden with a fake in tests."""
    return GoogleCalendarClient(
        client_id=settings.google_calendar_oauth_client_id,
        client_secret=settings.google_calendar_oauth_client_secret,
        redirect_uri=settings.google_calendar_oauth_redirect_uri,
    )
