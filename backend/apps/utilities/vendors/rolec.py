"""
Rolec Cloud API adapter.

Credentials dict expected keys:
  api_key  — Rolec Cloud API key
  base_url — API base URL (e.g. https://api.roleccloud.com/v1)

Rolec Cloud REST API reference: https://developer.roleccloud.com/
The /devices/{device_id}/readings endpoint returns the latest cumulative
meter value. Bulk: POST /devices/readings with body {"device_ids": [...]}
"""

import logging
from datetime import timezone as dt_timezone
from decimal import Decimal

import requests

from .base import BaseMeterVendor, DeviceNotFoundError, VendorConnectionError, VendorReading

logger = logging.getLogger(__name__)

_TIMEOUT = 10  # seconds


class RolecAdapter(BaseMeterVendor):

    def __init__(self, credentials: dict):
        self._api_key = credentials['api_key']
        self._base_url = credentials.get('base_url', 'https://api.roleccloud.com/v1').rstrip('/')
        self._session = requests.Session()
        self._session.headers.update({
            'Authorization': f'Bearer {self._api_key}',
            'Accept': 'application/json',
        })

    # ------------------------------------------------------------------
    # Single device
    # ------------------------------------------------------------------

    def fetch_reading(self, device_id: str) -> VendorReading:
        url = f'{self._base_url}/devices/{device_id}/readings'
        try:
            resp = self._session.get(url, timeout=_TIMEOUT)
        except requests.RequestException as exc:
            raise VendorConnectionError(str(exc)) from exc

        if resp.status_code == 404:
            raise DeviceNotFoundError(device_id)
        if not resp.ok:
            raise VendorConnectionError(
                f'Rolec API error {resp.status_code} for device {device_id}: {resp.text[:200]}'
            )

        return self._parse_single(resp.json())

    # ------------------------------------------------------------------
    # Bulk devices
    # ------------------------------------------------------------------

    def fetch_readings_bulk(self, device_ids: list[str]) -> list[VendorReading]:
        url = f'{self._base_url}/devices/readings'
        try:
            resp = self._session.post(url, json={'device_ids': device_ids}, timeout=_TIMEOUT)
        except requests.RequestException as exc:
            raise VendorConnectionError(str(exc)) from exc

        if not resp.ok:
            raise VendorConnectionError(
                f'Rolec bulk API error {resp.status_code}: {resp.text[:200]}'
            )

        readings = []
        for item in resp.json().get('readings', []):
            try:
                readings.append(self._parse_single(item))
            except Exception:
                logger.exception('Failed to parse Rolec reading for device %s', item.get('device_id'))
        return readings

    # ------------------------------------------------------------------
    # Connection test
    # ------------------------------------------------------------------

    def test_connection(self) -> None:
        url = f'{self._base_url}/sites/'
        try:
            resp = self._session.get(url, params={'limit': 1}, timeout=_TIMEOUT)
        except requests.RequestException as e:
            raise VendorConnectionError(f'Rolec API unreachable: {e}')
        if not resp.ok:
            raise VendorConnectionError(
                f'Rolec API returned {resp.status_code}: {resp.text[:200]}'
            )

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_single(data: dict) -> VendorReading:
        """
        Expected Rolec payload shape:
        {
          "device_id": "ABC123",
          "recorded_at": "2026-05-08T12:00:00Z",
          "cumulative_kwh": 1234.567,   // electricity meters
          "cumulative_m3": null          // water meters
        }
        """
        from datetime import datetime
        recorded_at = datetime.fromisoformat(data['recorded_at'].replace('Z', '+00:00'))
        kwh = data.get('cumulative_kwh')
        m3  = data.get('cumulative_m3')
        return VendorReading(
            device_id=data['device_id'],
            recorded_at=recorded_at,
            cumulative_kwh=Decimal(str(kwh)) if kwh is not None else None,
            cumulative_m3=Decimal(str(m3)) if m3 is not None else None,
        )
