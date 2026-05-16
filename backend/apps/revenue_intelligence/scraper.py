"""
CompetitorScraper — stub implementation.

Fetches the competitor's website and attempts to parse a nightly rate.
This is a best-effort heuristic scraper; real implementations should use
dedicated APIs or structured data (schema.org, OTA feeds).

Dependencies (add to requirements.txt if not present):
    requests
    beautifulsoup4
"""

from __future__ import annotations

import logging
import re
from decimal import Decimal, InvalidOperation
from typing import Optional

from django.utils import timezone

logger = logging.getLogger(__name__)

# Regex to find a price-like token: optional currency symbol, digits, optional decimals.
_PRICE_RE = re.compile(
    r'(?:€|\$|£|CHF|Fr\.?|EUR|USD|GBP)?\s*(\d{1,6}(?:[.,]\d{1,2})?)',
    re.IGNORECASE,
)

# Keywords that hint a figure is a per-night rate.
_NIGHT_KEYWORDS = ['per night', '/night', 'nightly', 'par nuit', 'pro nacht']


class CompetitorScraper:
    """Fetch and parse a rate from a competitor's public web page."""

    def __init__(self, competitor_rate):
        """
        Parameters
        ----------
        competitor_rate : CompetitorRate
            The model instance to update after scraping.
        """
        self.competitor_rate = competitor_rate

    def fetch_and_update(self) -> None:
        """Fetch the page, extract a rate, and update the model instance."""
        url = self.competitor_rate.competitor_url
        if not url:
            logger.debug('CompetitorScraper: no URL for %s', self.competitor_rate.pk)
            return

        raw_price = self._fetch_rate(url)
        if raw_price is not None:
            self.competitor_rate.rate_per_night = raw_price
            self.competitor_rate.scraped_at = timezone.now()
            self.competitor_rate.save(update_fields=['rate_per_night', 'scraped_at'])
            logger.info(
                'CompetitorScraper: updated rate for %s → %s',
                self.competitor_rate.competitor_name,
                raw_price,
            )
        else:
            logger.warning(
                'CompetitorScraper: could not parse rate from %s', url
            )

    def _fetch_rate(self, url: str) -> Optional[Decimal]:
        """Return a Decimal rate parsed from the page, or None on failure."""
        try:
            import requests
            from bs4 import BeautifulSoup
        except ImportError:
            logger.error(
                'CompetitorScraper: requests or beautifulsoup4 not installed. '
                'Add them to requirements.txt.'
            )
            return None

        try:
            resp = requests.get(url, timeout=15, headers={'User-Agent': 'DocksBase-RateBot/1.0'})
            resp.raise_for_status()
        except Exception as exc:
            logger.warning('CompetitorScraper: HTTP error for %s: %s', url, exc)
            return None

        soup = BeautifulSoup(resp.text, 'html.parser')

        # Strategy 1: look for schema.org/LodgingBusiness structured data.
        rate = self._parse_schema_org(soup)
        if rate is not None:
            return rate

        # Strategy 2: heuristic — find text near night keywords.
        rate = self._parse_heuristic(soup)
        return rate

    def _parse_schema_org(self, soup) -> Optional[Decimal]:
        """Try to extract a rate from schema.org JSON-LD."""
        import json

        for script in soup.find_all('script', type='application/ld+json'):
            try:
                data = json.loads(script.string or '')
                # Support both single object and list.
                items = data if isinstance(data, list) else [data]
                for item in items:
                    offers = item.get('offers') or item.get('containsPlace', {})
                    if isinstance(offers, dict):
                        price = offers.get('price') or offers.get('lowPrice')
                        if price:
                            return self._to_decimal(str(price))
            except Exception:
                continue
        return None

    def _parse_heuristic(self, soup) -> Optional[Decimal]:
        """Scan visible text for a price figure adjacent to 'per night' language."""
        text = soup.get_text(separator=' ', strip=True)
        lower = text.lower()

        for keyword in _NIGHT_KEYWORDS:
            idx = lower.find(keyword)
            if idx == -1:
                continue
            # Look in a window of 60 chars before the keyword for a price.
            window = text[max(0, idx - 60): idx + 20]
            match = _PRICE_RE.search(window)
            if match:
                return self._to_decimal(match.group(1))

        # Fallback: return the first price-looking token on the page.
        match = _PRICE_RE.search(text)
        if match:
            return self._to_decimal(match.group(1))

        return None

    @staticmethod
    def _to_decimal(value: str) -> Optional[Decimal]:
        """Normalise a string like '1.234,56' or '1,234.56' to a Decimal."""
        cleaned = value.replace(',', '.') if value.count(',') == 1 and '.' not in value else value
        cleaned = re.sub(r'[^\d.]', '', cleaned)
        try:
            return Decimal(cleaned)
        except InvalidOperation:
            return None
