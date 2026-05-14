"""
MarineSync adapter — STUB.

MarineSync API integration is deferred (v2 roadmap). This stub raises
NotImplementedError with a clear message so the polling service can
catch and log it rather than crashing.

When implementing: replace this class with a real HTTP adapter following
the same interface as RolecAdapter. The credentials dict is expected to
contain 'api_key' and 'base_url' keys from UtilityIntegration.credentials.
"""

from .base import BaseMeterVendor, VendorReading


class MarineSyncAdapter(BaseMeterVendor):

    def __init__(self, credentials: dict):
        self._credentials = credentials

    def fetch_reading(self, device_id: str) -> VendorReading:
        raise NotImplementedError(
            'MarineSync adapter is not yet implemented. '
            'This integration is scheduled for v2. '
            'Do not configure MarineSync UtilityIntegration records until the adapter is complete.'
        )

    def fetch_readings_bulk(self, device_ids: list[str]) -> list[VendorReading]:
        raise NotImplementedError(
            'MarineSync adapter is not yet implemented. '
            'This integration is scheduled for v2.'
        )

    def test_connection(self) -> None:
        raise NotImplementedError(
            'MarineSync adapter is not yet implemented. '
            'This integration is scheduled for v2.'
        )
