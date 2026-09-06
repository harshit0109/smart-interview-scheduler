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


settings = Settings()
