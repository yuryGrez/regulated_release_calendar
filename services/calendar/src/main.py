import os
from datetime import date, timedelta
from typing import Optional
import uuid

from fastapi import FastAPI, Depends, HTTPException, Query, Header
from sqlalchemy import select, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession
from apscheduler.schedulers.asyncio import AsyncIOScheduler
import structlog

from .db import get_session, RegulatoryWindow
from .models import RegulatoryWindowCreate, RegulatoryWindowOut
from .cache import get_windows_cached, set_windows_cache
from .scraper_runner import run_all_scrapers

logger = structlog.get_logger()
app = FastAPI(title='RRC Calendar Service', version='1.0.0')

# ── Scheduler ────────────────────────────────────────────────────────────────

scheduler = AsyncIOScheduler()

@app.on_event('startup')
async def startup():
    cron_expr = os.environ.get('SCRAPER_CRON', '0 9 * * 1')  # Mon 09:00
    parts = cron_expr.split()
    scheduler.add_job(
        run_all_scrapers,
        'cron',
        minute=parts[0], hour=parts[1], day=parts[2],
        month=parts[3], day_of_week=parts[4],
        id='scraper',
        replace_existing=True,
    )
    scheduler.start()
    logger.info('calendar_service_started')

@app.on_event('shutdown')
async def shutdown():
    scheduler.shutdown(wait=False)


# ── Auth helper ───────────────────────────────────────────────────────────────

def require_admin(x_tenant_id: Optional[str] = Header(None)):
    # For MVP: admin role is asserted by gateway via header; full JWT role check in Week 5
    if not x_tenant_id:
        raise HTTPException(status_code=401, detail={'code': 'NO_TENANT', 'message': 'Tenant context required'})


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get('/health')
async def health():
    return {'status': 'ok'}


@app.get('/api/v1/windows', response_model=list[RegulatoryWindowOut])
async def list_windows(
    jurisdiction: str = Query(...),
    year: int = Query(...),
    session: AsyncSession = Depends(get_session),
):
    if jurisdiction not in {'FCA', 'PRA', 'APRA', 'EBA', 'DORA'}:
        raise HTTPException(status_code=400, detail={'code': 'INVALID_JURISDICTION', 'message': 'Unknown jurisdiction'})

    cached = await get_windows_cached(jurisdiction, year)
    if cached is not None:
        return cached

    start = date(year, 1, 1)
    end = date(year, 12, 31)

    result = await session.execute(
        select(RegulatoryWindow).where(
            and_(
                RegulatoryWindow.jurisdiction == jurisdiction,
                RegulatoryWindow.start_date <= end,
                RegulatoryWindow.end_date >= start,
            )
        ).order_by(RegulatoryWindow.start_date)
    )
    windows = result.scalars().all()

    serialized = [
        {
            'id': w.id,
            'jurisdiction': w.jurisdiction,
            'type': w.type,
            'name': w.name,
            'start_date': w.start_date.isoformat(),
            'end_date': w.end_date.isoformat(),
            'source_url': w.source_url,
            'is_manual': w.is_manual,
            'created_at': w.created_at.isoformat(),
        }
        for w in windows
    ]

    await set_windows_cache(jurisdiction, year, serialized)
    return serialized


@app.get('/api/v1/windows/active', response_model=list[RegulatoryWindowOut])
async def list_active_windows(
    jurisdiction: str = Query(...),
    session: AsyncSession = Depends(get_session),
):
    if jurisdiction not in {'FCA', 'PRA', 'APRA', 'EBA', 'DORA'}:
        raise HTTPException(status_code=400, detail={'code': 'INVALID_JURISDICTION', 'message': 'Unknown jurisdiction'})

    today = date.today()
    horizon = today + timedelta(days=30)

    result = await session.execute(
        select(RegulatoryWindow).where(
            and_(
                RegulatoryWindow.jurisdiction == jurisdiction,
                RegulatoryWindow.end_date >= today,
                RegulatoryWindow.start_date <= horizon,
            )
        ).order_by(RegulatoryWindow.start_date)
    )
    return result.scalars().all()


@app.post('/api/v1/windows', response_model=RegulatoryWindowOut, status_code=201,
          dependencies=[Depends(require_admin)])
async def create_window(
    body: RegulatoryWindowCreate,
    session: AsyncSession = Depends(get_session),
):
    from datetime import datetime, timezone
    from .cache import invalidate_windows_cache

    window = RegulatoryWindow(
        id=str(uuid.uuid4()),
        jurisdiction=body.jurisdiction,
        type=body.type,
        name=body.name,
        start_date=body.start_date,
        end_date=body.end_date,
        source_url=body.source_url,
        is_manual=True,
        created_at=datetime.now(timezone.utc),
    )
    session.add(window)
    await session.commit()
    await session.refresh(window)

    await invalidate_windows_cache(body.jurisdiction, body.start_date.year)
    if body.end_date.year != body.start_date.year:
        await invalidate_windows_cache(body.jurisdiction, body.end_date.year)

    logger.info('window_created', id=window.id, jurisdiction=body.jurisdiction, name=body.name)
    return window


@app.get('/api/v1/windows/{window_id}', response_model=RegulatoryWindowOut)
async def get_window(
    window_id: str,
    session: AsyncSession = Depends(get_session),
):
    result = await session.execute(
        select(RegulatoryWindow).where(RegulatoryWindow.id == window_id)
    )
    window = result.scalar_one_or_none()
    if window is None:
        raise HTTPException(status_code=404, detail={'code': 'NOT_FOUND', 'message': 'Window not found'})
    return window


@app.post('/api/v1/windows/scrape', status_code=202, dependencies=[Depends(require_admin)])
async def trigger_scrape():
    """Manually trigger scraper run (admin only)."""
    import asyncio
    asyncio.create_task(run_all_scrapers())
    return {'status': 'scrape_triggered'}
