import os
import uuid
from datetime import date, datetime, timezone
from typing import Optional

from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy import text

DATABASE_URL = os.environ.get('DATABASE_URL', 'postgresql://rrc_user:password@localhost:5432/rrc_db')
ASYNC_DATABASE_URL = DATABASE_URL.replace('postgresql://', 'postgresql+asyncpg://', 1)

engine = create_async_engine(ASYNC_DATABASE_URL, echo=False, pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def fetch_windows_for_release(
    session: AsyncSession,
    jurisdiction: str,
    planned_date: date,
    lookahead_days: int = 7,
) -> list[dict]:
    """
    Returns regulatory windows whose date range overlaps with
    [planned_date - lookahead_days, planned_date + lookahead_days].
    """
    result = await session.execute(
        text("""
            SELECT id, jurisdiction, type, name,
                   start_date::text AS start_date,
                   end_date::text   AS end_date
            FROM regulatory_windows
            WHERE jurisdiction = :jurisdiction
              AND start_date <= :upper_bound
              AND end_date   >= :lower_bound
        """),
        {
            'jurisdiction': jurisdiction,
            'upper_bound': planned_date + __import__('datetime').timedelta(days=lookahead_days),
            'lower_bound': planned_date - __import__('datetime').timedelta(days=lookahead_days),
        }
    )
    return [dict(row._mapping) for row in result]


async def check_recent_score(session: AsyncSession, release_id: str, minutes: int = 5) -> bool:
    """Returns True if a risk score was computed in the last `minutes` minutes (idempotency guard)."""
    result = await session.execute(
        text("""
            SELECT 1 FROM risk_scores
            WHERE release_id = :release_id
              AND evaluated_at > now() - interval ':minutes minutes'
        """.replace(':minutes', str(minutes))),
        {'release_id': release_id}
    )
    return result.scalar() is not None


async def persist_risk_score(
    session: AsyncSession,
    release_id: str,
    level: str,
    score: int,
    reasons: list[dict],
) -> str:
    """Inserts a new risk_scores row. Returns the new row id."""
    import json
    row_id = str(uuid.uuid4())
    await session.execute(
        text("""
            INSERT INTO risk_scores (id, release_id, level, score, reasons, evaluated_at)
            VALUES (:id, :release_id, :level, :score, :reasons::jsonb, now())
        """),
        {
            'id': row_id,
            'release_id': release_id,
            'level': level,
            'score': score,
            'reasons': json.dumps(reasons),
        }
    )
    return row_id


async def persist_audit_log(
    session: AsyncSession,
    release_id: str,
    tenant_id: str,
    release_name: str,
    planned_date: date,
    level: str,
    score: int,
    reasons: list[dict],
    windows_evaluated: list[dict],
) -> None:
    import json
    await session.execute(
        text("""
            INSERT INTO audit_log
              (id, release_id, tenant_id, release_name, planned_date,
               level, score, reasons, windows_evaluated, timestamp)
            VALUES
              (:id, :release_id, :tenant_id, :release_name, :planned_date,
               :level, :score, :reasons::jsonb, :windows_evaluated::jsonb, now())
        """),
        {
            'id': str(uuid.uuid4()),
            'release_id': release_id,
            'tenant_id': tenant_id,
            'release_name': release_name,
            'planned_date': planned_date,
            'level': level,
            'score': score,
            'reasons': json.dumps(reasons),
            'windows_evaluated': json.dumps(windows_evaluated, default=str),
        }
    )


async def fetch_release(session: AsyncSession, release_id: str) -> Optional[dict]:
    result = await session.execute(
        text('SELECT id, tenant_id, name, planned_date FROM releases WHERE id = :id AND deleted_at IS NULL'),
        {'id': release_id}
    )
    row = result.fetchone()
    return dict(row._mapping) if row else None
