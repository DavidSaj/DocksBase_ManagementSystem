from abc import ABC, abstractmethod
from dataclasses import dataclass
from decimal import Decimal
from datetime import date


@dataclass
class AvailabilitySlot:
    berth_id: int
    berth_code: str
    berth_category: str
    date: date
    is_available: bool
    rate: Decimal
    min_stay: int = 1
    currency: str = 'EUR'


class OTAAdapter(ABC):
    def __init__(self, channel):
        self.channel = channel

    @abstractmethod
    def push_availability(self, berths, date_from, date_to) -> dict: ...

    @abstractmethod
    def pull_bookings(self, since) -> list: ...

    @abstractmethod
    def cancel_booking(self, ota_ref) -> bool: ...

    def parse_webhook_payload(self, payload) -> list:
        return []
