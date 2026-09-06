"""The single SendGrid HTTP seam (one POST via httpx — no vendor SDK).

Tests inject a fake with the same `send()` surface. The API key never reaches a
log line.
"""

from dataclasses import dataclass

import httpx

from app.core.config import settings

_SEND_URI = "https://api.sendgrid.com/v3/mail/send"
_TIMEOUT = httpx.Timeout(10.0)


@dataclass(frozen=True)
class EmailMessage:
    to: str
    cc: list[str]
    subject: str
    text_body: str


class SendGridClient:
    def __init__(self, *, api_key: str, from_address: str,
                 transport: httpx.BaseTransport | None = None) -> None:
        self._api_key = api_key
        self._from = from_address
        self._transport = transport

    @property
    def configured(self) -> bool:
        return bool(self._api_key)

    async def send(self, msg: EmailMessage) -> None:
        """Deliver `msg`, or raise on any failure (caller maps to a FAILED row)."""
        personalization: dict = {"to": [{"email": msg.to}]}
        if msg.cc:
            personalization["cc"] = [{"email": e} for e in msg.cc]
        payload = {
            "personalizations": [personalization],
            "from": {"email": self._from},
            "subject": msg.subject,
            "content": [{"type": "text/plain", "value": msg.text_body}],
        }
        async with httpx.AsyncClient(timeout=_TIMEOUT, transport=self._transport) as http:
            resp = await http.post(
                _SEND_URI,
                json=payload,
                headers={"Authorization": f"Bearer {self._api_key}"},
            )
        if resp.status_code >= 300:
            raise RuntimeError(f"SendGrid responded {resp.status_code}")


def get_sendgrid_client() -> SendGridClient:
    """FastAPI dependency — overridden with a fake in tests."""
    return SendGridClient(
        api_key=settings.sendgrid_api_key,
        from_address=settings.email_from_address,
    )
