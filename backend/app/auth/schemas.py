"""Pydantic request/response models — source of truth for auth input validation."""

import uuid

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.core.validators import valid_iana_timezone


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    name: str = Field(min_length=1, max_length=255)
    timezone: str = "UTC"

    @field_validator("password")
    @classmethod
    def _password_has_digit(cls, v: str) -> str:
        if not any(c.isdigit() for c in v):
            raise ValueError("password must contain at least one number")
        return v

    @field_validator("timezone")
    @classmethod
    def _valid_timezone(cls, v: str) -> str:
        return valid_iana_timezone(v)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class GoogleLoginRequest(BaseModel):
    id_token: str


class RefreshRequest(BaseModel):
    refresh_token: str


class UserSummary(BaseModel):
    id: uuid.UUID
    role: str


class RegisterResponse(BaseModel):
    id: uuid.UUID
    email: EmailStr
    name: str
    role: str


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: UserSummary


class AccessToken(BaseModel):
    access_token: str
    token_type: str = "bearer"
