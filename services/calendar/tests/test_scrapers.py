"""
Scraper unit tests — all HTTP calls are mocked. No real network calls, no DB, no FastAPI.
Run with: python -m pytest tests/test_scrapers.py
"""
import pytest
from datetime import date
from unittest.mock import patch, MagicMock

from src.scrapers.fca import FcaScraper, _parse_date, _classify_window
from src.scrapers.pra import PraScraper
from src.scrapers.apra import ApraScraper
from src.scrapers.base import ScrapedWindow
import feedparser


# ── Date parsing helpers ──────────────────────────────────────────────────────

class TestParseDate:
    def test_valid_date(self):
        assert _parse_date('1', 'January', '2026') == date(2026, 1, 1)

    def test_leading_zero_day(self):
        assert _parse_date('07', 'March', '2026') == date(2026, 3, 7)

    def test_invalid_day(self):
        assert _parse_date('32', 'January', '2026') is None

    def test_invalid_month(self):
        assert _parse_date('1', 'Octember', '2026') is None

    def test_case_insensitive(self):
        assert _parse_date('15', 'SEPTEMBER', '2026') == date(2026, 9, 15)


class TestClassifyWindow:
    def test_blackout_keyword(self):
        assert _classify_window('This is a change freeze period') == 'BLACKOUT'

    def test_freeze_keyword(self):
        assert _classify_window('Stabilisation freeze applies') == 'FREEZE'

    def test_default_freeze(self):
        assert _classify_window('Restricted deployment window') == 'FREEZE'


# ── FCA Scraper ───────────────────────────────────────────────────────────────

FCA_HTML = """
<html><body>
  <article>
    <h3><a href="/cp/2026-01">CP2026/01: Technology Change Freeze</a></h3>
    <p>Firms must not deploy changes between 1 July 2026 and 14 July 2026
       due to the FCA Q3 change freeze period.</p>
  </article>
  <article>
    <h3><a href="/news/2026-budget">Pre-Budget stabilisation</a></h3>
    <p>A freeze applies from 20 October 2026 to 1 November 2026.</p>
  </article>
  <article>
    <h3>Unrelated article about mortgage rates</h3>
    <p>Rates changed on 5 March 2026. No regulatory window here.</p>
  </article>
</body></html>
"""


class TestFcaScraper:
    @patch('src.scrapers.fca.requests.get')
    def test_scrape_extracts_blackout_window(self, mock_get):
        mock_resp = MagicMock()
        mock_resp.text = FCA_HTML
        mock_resp.raise_for_status = MagicMock()
        mock_get.return_value = mock_resp

        scraper = FcaScraper()
        scraper.URLS = ['https://www.fca.org.uk/publications/consultation-papers']
        windows = scraper.scrape()

        assert len(windows) >= 1
        w = windows[0]
        assert w.jurisdiction == 'FCA'
        assert w.start_date == date(2026, 7, 1)
        assert w.end_date == date(2026, 7, 14)
        assert w.type in ('BLACKOUT', 'FREEZE')

    @patch('src.scrapers.fca.requests.get')
    def test_scrape_finds_second_window(self, mock_get):
        mock_resp = MagicMock()
        mock_resp.text = FCA_HTML
        mock_resp.raise_for_status = MagicMock()
        mock_get.return_value = mock_resp

        scraper = FcaScraper()
        scraper.URLS = ['https://www.fca.org.uk/publications/consultation-papers']
        windows = scraper.scrape()

        dates = [(w.start_date, w.end_date) for w in windows]
        assert (date(2026, 10, 20), date(2026, 11, 1)) in dates

    @patch('src.scrapers.fca.requests.get')
    def test_scrape_ignores_non_window_articles(self, mock_get):
        mock_resp = MagicMock()
        mock_resp.text = FCA_HTML
        mock_resp.raise_for_status = MagicMock()
        mock_get.return_value = mock_resp

        scraper = FcaScraper()
        scraper.URLS = ['https://www.fca.org.uk/publications/consultation-papers']
        windows = scraper.scrape()

        names = [w.name.lower() for w in windows]
        assert not any('mortgage' in n for n in names)

    @patch('src.scrapers.fca.requests.get')
    def test_scrape_survives_http_error(self, mock_get):
        import requests as req_lib
        mock_get.side_effect = req_lib.RequestException('timeout')

        scraper = FcaScraper()
        scraper.URLS = ['https://www.fca.org.uk/publications/consultation-papers']
        windows = scraper.scrape()
        assert windows == []

    @patch('src.scrapers.fca.requests.get')
    def test_safe_scrape_returns_empty_on_crash(self, mock_get):
        mock_get.side_effect = Exception('unexpected crash')

        scraper = FcaScraper()
        windows = scraper._safe_scrape()
        assert windows == []

    @patch('src.scrapers.fca.requests.get')
    def test_source_url_attached(self, mock_get):
        mock_resp = MagicMock()
        mock_resp.text = FCA_HTML
        mock_resp.raise_for_status = MagicMock()
        mock_get.return_value = mock_resp

        target = 'https://www.fca.org.uk/publications/consultation-papers'
        scraper = FcaScraper()
        scraper.URLS = [target]
        windows = scraper.scrape()

        assert all(w.source_url == target for w in windows)


# ── PRA Scraper ───────────────────────────────────────────────────────────────

class TestPraScraper:
    @patch('src.scrapers.pra.feedparser.parse')
    def test_scrape_parses_freeze_entry(self, mock_parse):
        mock_parse.return_value = feedparser.FeedParserDict({
            'entries': [
                {
                    'title': 'PRA Supervisory Statement: Change Freeze December 2026',
                    'summary': 'A freeze period applies from 1 December 2026 to 5 December 2026.',
                    'link': 'https://www.bankofengland.co.uk/ss',
                }
            ]
        })

        scraper = PraScraper()
        windows = scraper.scrape()

        assert len(windows) == 1
        assert windows[0].jurisdiction == 'PRA'
        assert windows[0].start_date == date(2026, 12, 1)
        assert windows[0].end_date == date(2026, 12, 5)

    @patch('src.scrapers.pra.feedparser.parse')
    def test_scrape_skips_unrelated_entries(self, mock_parse):
        mock_parse.return_value = feedparser.FeedParserDict({
            'entries': [
                {'title': 'Discussion Paper DP1/26', 'summary': 'Capital requirements.', 'link': ''}
            ]
        })

        scraper = PraScraper()
        windows = scraper.scrape()
        assert windows == []

    @patch('src.scrapers.pra.feedparser.parse')
    def test_scrape_classifies_audit_proximity(self, mock_parse):
        mock_parse.return_value = feedparser.FeedParserDict({
            'entries': [
                {
                    'title': 'SREP Supervisory Assessment period',
                    'summary': 'Annual supervisory review assessment from 1 September 2026 to 15 September 2026.',
                    'link': '',
                }
            ]
        })

        scraper = PraScraper()
        windows = scraper.scrape()

        assert len(windows) == 1
        assert windows[0].type == 'AUDIT_PROXIMITY'

    @patch('src.scrapers.pra.feedparser.parse')
    def test_scrape_survives_parse_error(self, mock_parse):
        mock_parse.side_effect = Exception('parse error')

        scraper = PraScraper()
        windows = scraper.scrape()
        assert windows == []

    @patch('src.scrapers.pra.feedparser.parse')
    def test_scrape_returns_empty_on_empty_feed(self, mock_parse):
        mock_parse.return_value = feedparser.FeedParserDict({'entries': []})

        scraper = PraScraper()
        windows = scraper.scrape()
        assert windows == []


# ── ScrapedWindow dataclass ───────────────────────────────────────────────────

class TestScrapedWindow:
    def test_fields(self):
        w = ScrapedWindow(
            jurisdiction='FCA',
            type='BLACKOUT',
            name='Test freeze',
            start_date=date(2026, 7, 1),
            end_date=date(2026, 7, 14),
            source_url='https://example.com',
        )
        assert w.jurisdiction == 'FCA'
        assert w.type == 'BLACKOUT'
        assert w.end_date > w.start_date

    def test_source_url_optional(self):
        w = ScrapedWindow(
            jurisdiction='PRA', type='FREEZE', name='Test',
            start_date=date(2026, 1, 1), end_date=date(2026, 1, 5),
        )
        assert w.source_url is None
