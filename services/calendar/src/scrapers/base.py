from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import date
from typing import Optional
import structlog

logger = structlog.get_logger()


@dataclass
class ScrapedWindow:
    jurisdiction: str
    type: str          # BLACKOUT | FREEZE | AUDIT_PROXIMITY
    name: str
    start_date: date
    end_date: date
    source_url: Optional[str] = None


class BaseScraper(ABC):
    jurisdiction: str

    @abstractmethod
    def scrape(self) -> list[ScrapedWindow]:
        """Fetch and parse regulatory windows. Returns empty list on failure (never raises)."""
        ...

    def _safe_scrape(self) -> list[ScrapedWindow]:
        try:
            return self.scrape()
        except Exception as e:
            logger.error('scraper_failed', jurisdiction=self.jurisdiction, error=str(e))
            return []
