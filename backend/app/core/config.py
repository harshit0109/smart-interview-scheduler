"""Application configuration.

Phase 1 only reads what the infrastructure health check needs. Later phases add
their own settings (JWT, OAuth, SendGrid, ...) when they are actually used.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = "development"

    # Local-dev defaults match docker-compose.yml; override via env / .env.
    database_url: str = "postgresql+asyncpg://sis:sis@localhost:5432/sis"
    redis_url: str = "redis://localhost:6379/0"


settings = Settings()
