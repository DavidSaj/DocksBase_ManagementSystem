"""
MarineTraffic 'simple' export protocol.
Docs: https://www.marinetraffic.com/en/ais-api-services/detail/ps01
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from decimal import Decimal

import requests

from .base import AISProvider, AISReading, BBox

logger = logging.getLogger(__name__)

_TIMEOUT = 10


class MarineTrafficAdapter(AISProvider):
    BASE_URL = 'https://services.marinetraffic.com/api/exportvessels'

    def __init__(self, api_key: str):
        self.api_key = api_key

    def fetch_positions(self, bbox: BBox) -> list[AISReading]:
        minlat, maxlat, minlng, maxlng = bbox
        url = f'{self.BASE_URL}/v:8/{self.api_key}/'
        params = {
            'protocol': 'jsono',
            'msgtype': 'simple',
            'minlat': minlat, 'maxlat': maxlat,
            'minlon': minlng, 'maxlon': maxlng,
        }
        resp = requests.get(url, params=params, timeout=_TIMEOUT)
        if not resp.ok:
            raise RuntimeError(
                f'MarineTraffic API returned {resp.status_code}: {resp.text[:200]}'
            )
        return [r for r in (_parse_row(row) for row in resp.json()) if r is not None]


def _parse_row(row: dict) -> AISReading | None:
    try:
        return AISReading(
            mmsi=str(row['MMSI']),
            lat=Decimal(str(row['LAT'])),
            lng=Decimal(str(row['LON'])),
            speed_kn=(Decimal(str(row['SPEED'])) / Decimal('10')) if row.get('SPEED') not in (None, '') else None,
            course_deg=int(row['COURSE']) if row.get('COURSE') not in (None, '') else None,
            heading_deg=int(row['HEADING']) if row.get('HEADING') not in (None, '') else None,
            nav_status=str(row.get('STATUS') or ''),
            reported_at=_parse_ts(row['TIMESTAMP']),
        )
    except Exception:
        logger.warning('Skipping malformed MarineTraffic row: %s', row)
        return None


def _parse_ts(s: str) -> datetime:
    # MT format: 'YYYY-MM-DDTHH:MM:SS' in UTC.
    return datetime.strptime(s, '%Y-%m-%dT%H:%M:%S').replace(tzinfo=timezone.utc)
