"""
Vendor abstraction layer for smart meter polling.

All vendor adapters inherit from BaseMeterVendor and return VendorReading
dataclass instances. The factory function get_vendor_adapter() resolves the
correct adapter from the marina's UtilityIntegration record.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal


@dataclass
class VendorReading:
    device_id: str
    recorded_at: datetime
    cumulative_kwh: Decimal | None = None
    cumulative_m3: Decimal | None = None


class VendorConnectionError(Exception):
    """Raised when the vendor API is unreachable or returns an HTTP error."""


class DeviceNotFoundError(Exception):
    """Raised when device_id is unknown to the vendor platform."""


class BaseMeterVendor(ABC):

    @abstractmethod
    def __init__(self, credentials: dict):
        """credentials: decrypted dict from UtilityIntegration.credentials"""

    @abstractmethod
    def fetch_reading(self, device_id: str) -> VendorReading:
        """Fetch a single device reading."""
        ...

    @abstractmethod
    def fetch_readings_bulk(self, device_ids: list[str]) -> list[VendorReading]:
        """Fetch readings for multiple devices in one API call where supported."""
        ...


def get_vendor_adapter(vendor_key: str, marina_id: int) -> BaseMeterVendor:
    """
    Looks up the active UtilityIntegration for the given marina + vendor,
    decrypts credentials, and returns the appropriate adapter instance.

    Raises:
        UtilityIntegration.DoesNotExist: if no active integration is configured.
        ValueError: if vendor_key is unknown.
    """
    from apps.utilities.models import UtilityIntegration

    integration = UtilityIntegration.objects.get(
        marina_id=marina_id, vendor=vendor_key, is_active=True
    )

    if vendor_key == 'rolec':
        from .rolec import RolecAdapter
        return RolecAdapter(integration.credentials)
    elif vendor_key == 'marinesync':
        from .marinesync import MarineSyncAdapter
        return MarineSyncAdapter(integration.credentials)

    raise ValueError(f'Unknown vendor: {vendor_key}')
