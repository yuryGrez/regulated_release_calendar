"""
Runs all scrapers, deduplicates against existing DB windows,
inserts new ones, and invalidates Redis cache for affected jurisdiction+year combos.
"""
import uuid
from datetime import datetime, timezone
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
import structlog

from .db import SessionLocal, RegulatoryWindow
from .cache import invalidate_windows_cache
from .scrapers.fca import FcaScraper
from .scrapers.pra import PraScraper
from .scrapers.apra import ApraScraper
from .scrapers.base import ScrapedWindow

logger = structlog.get_logger()

SCRAPERS = [FcaScraper(), PraScraper(), ApraScraper()]


async def run_all_scrapers() -> dict:
    results = {'scraped': 0, 'inserted': 0, 'skipped': 0, 'errors': 0}

    async with SessionLocal() as session:
        for scraper in SCRAPERS:
            windows = scraper._safe_scrape()
            results['scraped'] += len(windows)

            for window in windows:
                try:
                    inserted = await _upsert_window(session, window)
                    if inserted:
                        results['inserted'] += 1
                        await invalidate_windows_cache(window.jurisdiction, window.start_date.year)
                        if window.end_date.year != window.start_date.year:
                            await invalidate_windows_cache(window.jurisdiction, window.end_date.year)
                    else:
                        results['skipped'] += 1
                except Exception as e:
                    results['errors'] += 1
                    logger.error('window_insert_failed', window=window.name, error=str(e))
                    await session.rollback()

        await session.commit()

    logger.info('scraper_run_complete', **results)
    return results


async def _upsert_window(session: AsyncSession, w: ScrapedWindow) -> bool:
    """Returns True if a new row was inserted, False if duplicate skipped."""
    existing = await session.execute(
        select(RegulatoryWindow).where(
            and_(
                RegulatoryWindow.jurisdiction == w.jurisdiction,
                RegulatoryWindow.name == w.name,
                RegulatoryWindow.start_date == w.start_date,
            )
        )
    )
    if existing.scalar_one_or_none() is not None:
        return False

    session.add(RegulatoryWindow(
        id=str(uuid.uuid4()),
        jurisdiction=w.jurisdiction,
        type=w.type,
        name=w.name,
        start_date=w.start_date,
        end_date=w.end_date,
        source_url=w.source_url,
        is_manual=False,
        created_at=datetime.now(timezone.utc),
    ))
    return True
