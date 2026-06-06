import re
from datetime import date
from typing import Optional
import requests
from bs4 import BeautifulSoup
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
_WINDOW_KEYWORDS = re.compile(r'change freeze|blackout|moratorium|restricted|freeze', re.IGNORECASE)


def _parse_date(day: str, month: str, year: str) -> Optional[date]:
    try:
        return date(int(year), _MONTH_MAP[month.lower()], int(day))
    except (ValueError, KeyError):
        return None


class ApraScraper(BaseScraper):
    jurisdiction = 'APRA'

    URLS = [
        'https://www.apra.gov.au/news-and-publications',
    ]

    def scrape(self) -> list[ScrapedWindow]:
        windows: list[ScrapedWindow] = []

        for url in self.URLS:
            try:
                resp = requests.get(url, timeout=15, headers={'User-Agent': 'RRC-Scraper/1.0'})
                resp.raise_for_status()
            except requests.RequestException as e:
                logger.warning('apra_fetch_failed', url=url, error=str(e))
                continue

            soup = BeautifulSoup(resp.text, 'html.parser')

            for item in soup.find_all(['article', 'li', 'div'], limit=200):
                text = item.get_text(separator=' ', strip=True)
                if not _WINDOW_KEYWORDS.search(text):
                    continue

                parsed_dates = [_parse_date(*m) for m in _DATE_PATTERN.findall(text)]
                parsed_dates = [d for d in parsed_dates if d is not None]
                if not parsed_dates:
                    continue

                heading = item.find(['h2', 'h3', 'h4', 'a'])
                name = heading.get_text(strip=True)[:200] if heading else text[:100]

                windows.append(ScrapedWindow(
                    jurisdiction='APRA',
                    type='FREEZE',
                    name=name,
                    start_date=min(parsed_dates),
                    end_date=max(parsed_dates) if len(parsed_dates) > 1 else min(parsed_dates),
                    source_url=url,
                ))

        logger.info('apra_scrape_complete', windows_found=len(windows))
        return windows
