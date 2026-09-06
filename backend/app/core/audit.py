"""Minimal audit-log writer (FR-037).

Opportunistic: callers add a row for key state-changing actions. No audit
endpoint/UI — that is Post-MVP (IMPLEMENTATION.md Phase 9). The caller owns the
transaction; this only stages the insert.
"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.models import AuditLog


async def record_audit(
    db: AsyncSession,
    *,
    actor_id: uuid.UUID | None,
    actor_role: str,
    action: str,
    entity_type: str,
    entity_id: uuid.UUID,
    metadata: dict | None = None,
) -> None:
    db.add(
        AuditLog(
            actor_id=actor_id,
            actor_role=actor_role,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            audit_metadata=metadata or {},
        )
    )
    await db.flush()
