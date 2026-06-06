import re
from datetime import date, datetime
from typing import Optional
import requests
from bs4 import BeautifulSoup
import structlog

from .base import BaseScraper, ScrapedWindow

logger = structlog.get_logger()

# Date patterns found in FCA publications
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

# Keywords that suggest a window type
_BLACKOUT_KEYWORDS = re.compile(r'change freeze|blackout|moratorium|no[- ]change', re.IGNORECASE)
_FREEZE_KEYWORDS = re.compile(r'freeze|restricted|stabilisation', re.IGNORECASE)


def _parse_date(day: str, month: str, year: str) -> Optional[date]:
    try:
        return date(int(year), _MONTH_MAP[month.lower()], int(day))
    except (ValueError, KeyError):
        return None


def _classify_window(text: str) -> str:
    if _BLACKOUT_KEYWORDS.search(text):
        return 'BLACKOUT'
    if _FREEZE_KEYWORDS.search(text):
        return 'FREEZE'
    return 'FREEZE'


class FcaScraper(BaseScraper):
    jurisdiction = 'FCA'

    URLS = [
        'https://www.fca.org.uk/publications/consultation-papers',
        'https://www.fca.org.uk/news/news-stories',
    ]

    def scrape(self) -> list[ScrapedWindow]:
        windows: list[ScrapedWindow] = []

        for url in self.URLS:
            try:
                resp = requests.get(url, timeout=15, headers={'User-Agent': 'RRC-Scraper/1.0'})
                resp.raise_for_status()
            except requests.RequestException as e:
                logger.warning('fca_fetch_failed', url=url, error=str(e))
                continue

            soup = BeautifulSoup(resp.text, 'html.parser')
            windows.extend(self._parse_page(soup, url))

        logger.info('fca_scrape_complete', windows_found=len(windows))
        return windows

    def _parse_page(self, soup: BeautifulSoup, source_url: str) -> list[ScrapedWindow]:
        windows = []

        # Look for articles / list items mentioning change windows
        for item in soup.find_all(['article', 'li', 'div'], limit=200):
            text = item.get_text(separator=' ', strip=True)
            if not (_BLACKOUT_KEYWORDS.search(text) or _FREEZE_KEYWORDS.search(text)):
                continue

            dates = _DATE_PATTERN.findall(text)
            if len(dates) < 1:
                continue

            parsed_dates = [_parse_date(*d) for d in dates]
            parsed_dates = [d for d in parsed_dates if d is not None]
            if not parsed_dates:
                continue

            start = min(parsed_dates)
            end = max(parsed_dates) if len(parsed_dates) > 1 else start

            # Extract a short name from the first heading-like element
            heading = item.find(['h2', 'h3', 'h4', 'a'])
            name = heading.get_text(strip=True)[:200] if heading else text[:100]

            windows.append(ScrapedWindow(
                jurisdiction='FCA',
                type=_classify_window(text),
                name=name,
                start_date=start,
                end_date=end,
                source_url=source_url,
            ))

        return windows
