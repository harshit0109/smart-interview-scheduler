"""Application configuration.

Each phase adds only the settings it actually uses. Phase 1: infra. Phase 2:
auth (JWT + Google identity login). Calendar / SendGrid land in their phases.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = "development"

    # Local-dev defaults match docker-compose.yml; override via env / .env.
    database_url: str = "postgresql+asyncpg://sis:sis@localhost:5432/sis"
    redis_url: str = "redis://localhost:6379/0"

    # Auth / JWT. The default is dev-only — set JWT_SECRET in every real env.
    jwt_secret: str = "dev-insecure-change-me"
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 30
    jwt_refresh_token_expire_days: int = 7

    # Google IDENTITY login only (openid/email/profile). Never Calendar scopes.
    # Empty in dev/test; /auth/google returns 401 until configured.
    google_login_oauth_client_id: str = ""

    # Google CALENDAR connection only (calendar.freebusy / calendar.events).
    # A separate OAuth client from the login one (CODING_GUIDELINES §OAuth Architecture).
    google_calendar_oauth_client_id: str = ""
    google_calendar_oauth_client_secret: str = ""
    google_calendar_oauth_redirect_uri: str = "http://localhost:8000/api/v1/calendar/callback"
    calendar_state_ttl_seconds: int = 300  # strict 5-minute OAuth-state window

    # Fernet key for encrypting Calendar OAuth tokens at rest. The sentinel "dev"
    # derives a throwaway local key (app/core/crypto.py); production MUST set a
    # real key and the app refuses to start without one when environment=production.
    calendar_token_encryption_key: str = "dev"

    # Where GET /calendar/callback redirects the browser back to.
    frontend_base_url: str = "http://localhost:3000"

    # Booking-confirmation email (Phase 8). Empty API key -> the confirmation is
    # logged and recorded as SIMULATED (requirements.md §5 documented fallback).
    sendgrid_api_key: str = ""
    email_from_address: str = "no-reply@smart-interview-scheduler.example"

    # Rate limiting (Phase 11). Redis-backed fixed-window counter; fails OPEN if
    # Redis is unreachable (DB_DESIGN.md §Redis Design — "degrades performance,
    # never correctness"). Limits per API_DESIGN.md §Rate Limiting.
    rate_limit_enabled: bool = True
    # Trust the first X-Forwarded-For hop for the client IP. True is correct when
    # the app runs behind exactly one trusted proxy (the Next.js rewrite proxy /
    # a single load balancer); set False if the edge is untrusted.
    rate_limit_trust_forwarded_for: bool = True
    rate_limit_window_seconds: int = 60
    rate_limit_strict_per_minute: int = 10  # public + candidate-facing endpoints
    rate_limit_standard_per_minute: int = 60  # all other authenticated endpoints
    rate_limit_recommendations_per_minute: int = 5  # Google Free/Busy amplification
    rate_limit_booking_per_minute: int = 10  # Google event create/delete + lock + txn


settings = Settings()
