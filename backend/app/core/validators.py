"""Shared field validators reused across module schemas."""

from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


def valid_iana_timezone(v: str) -> str:
    """Return `v` unchanged if it names a real IANA zone, else raise ValueError."""
    try:
        ZoneInfo(v)
    except (ZoneInfoNotFoundError, ValueError):
        raise ValueError("not a valid IANA time zone") from None
    return v
