"""Shared pagination: `?page=&size=` query params + `{items,page,size,total}` envelope.

API_DESIGN.md §Pagination — 0-indexed page, size default 20 / max 100.
"""

from typing import Annotated

from fastapi import Query
from pydantic import BaseModel


class PageParams(BaseModel):
    page: int = 0
    size: int = 20


def page_params(
    page: Annotated[int, Query(ge=0)] = 0,
    size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> PageParams:
    return PageParams(page=page, size=size)


class Page[T](BaseModel):
    items: list[T]
    page: int
    size: int
    total: int
