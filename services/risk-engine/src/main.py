"""
FastAPI app for the Risk Engine.
Exposes a synchronous /evaluate endpoint for direct calls (e.g. from tests/admin).
The primary path is the SQS worker (worker.py).
"""
from datetime import date
from fastapi import FastAPI, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
import structlog

from .db import SessionLocal, fetch_windows_for_release, persist_risk_score, fetch_release
from .models import ReleaseEvaluateRequest, RiskScoreOut, RiskReasonOut
from .scoring import score_release

logger = structlog.get_logger()
app = FastAPI(title='RRC Risk Engine', version='1.0.0')


async def get_session():
    async with SessionLocal() as session:
        yield session


@app.get('/health')
async def health():
    return {'status': 'ok'}


@app.post('/api/v1/evaluate', response_model=RiskScoreOut)
async def evaluate(body: ReleaseEvaluateRequest, session: AsyncSession = Depends(get_session)):
    """
    Synchronously evaluate a release and persist the result.
    Called directly (bypass SQS) for admin re-evaluation or testing.
    """
    windows = await fetch_windows_for_release(session, body.jurisdiction, body.planned_date)
    result = score_release(body.planned_date, windows)

    reasons_dicts = [
        {'window_id': r.window_id, 'window_name': r.window_name, 'type': r.type, 'points': r.points}
        for r in result.reasons
    ]

    await persist_risk_score(session, body.release_id, result.level, result.score, reasons_dicts)
    await session.commit()

    logger.info('risk_evaluated', release_id=body.release_id, level=result.level, score=result.score)

    return RiskScoreOut(
        level=result.level,
        score=result.score,
        reasons=[RiskReasonOut(**r) for r in reasons_dicts],
    )
