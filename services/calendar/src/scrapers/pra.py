import re
from datetime import date
from typing import Optional
import feedparser
import requests
import structlog

from .base import BaseScraper, ScrapedWindow

logger = structlog.get_logger()

_DATE_PATTERN = re.compile(
    r'\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|'
    r'September|October|November|December)\s+(\d{4})\b',
    re.IGNORECASE
)
_MONTH_MAP = {
    'january': 1, 'february': 2, 'march': 3, 'april': 4,
    'may': 5, 'june': 6, 'july': 7, 'august': 8,
    'september': 9, 'october': 10, 'november': 11, 'december': 12,
}
_WINDOW_KEYWORDS = re.compile(r'change freeze|blackout|moratorium|freeze|stabilisation', re.IGNORECASE)
_AUDIT_KEYWORDS = re.compile(r'supervisory review|srep|audit|assessment', re.IGNORECASE)


def _parse_date(day: str, month: str, year: str) -> Optional[date]:
    try:
        return date(int(year), _MONTH_MAP[month.lower()], int(day))
    except (ValueError, KeyError):
        return None


class PraScraper(BaseScraper):
    jurisdiction = 'PRA'

    RSS_URL = 'https://www.bankofengland.co.uk/rss/publications'

    def scrape(self) -> list[ScrapedWindow]:
        windows: list[ScrapedWindow] = []

        try:
            feed = feedparser.parse(self.RSS_URL)
        except Exception as e:
            logger.error('pra_rss_failed', url=self.RSS_URL, error=str(e))
            return []

        for entry in feed.entries:
            title = entry.get('title', '')
            summary = entry.get('summary', '')
            link = entry.get('link', '')
            combined = f'{title} {summary}'

            if not (_WINDOW_KEYWORDS.search(combined) or _AUDIT_KEYWORDS.search(combined)):
                continue

            parsed_dates = [
                _parse_date(*m)
                for m in _DATE_PATTERN.findall(combined)
            ]
            parsed_dates = [d for d in parsed_dates if d is not None]

            if not parsed_dates:
                # Try fetching the linked page for more detail
                parsed_dates = self._fetch_dates_from_page(link)

            if not parsed_dates:
                continue

            start = min(parsed_dates)
            end = max(parsed_dates) if len(parsed_dates) > 1 else start

            wtype = 'AUDIT_PROXIMITY' if _AUDIT_KEYWORDS.search(combined) else 'FREEZE'

            windows.append(ScrapedWindow(
                jurisdiction='PRA',
                type=wtype,
                name=title[:200],
                start_date=start,
                end_date=end,
                source_url=link,
            ))

        logger.info('pra_scrape_complete', windows_found=len(windows))
        return windows

    def _fetch_dates_from_page(self, url: str) -> list[date]:
        if not url:
            return []
        try:
            resp = requests.get(url, timeout=10, headers={'User-Agent': 'RRC-Scraper/1.0'})
            resp.raise_for_status()
            matches = _DATE_PATTERN.findall(resp.text)
            return [d for d in (_parse_date(*m) for m in matches) if d is not None][:10]
        except Exception:
            return []
