"""
AIS provider abstraction.

Subclasses implement `fetch_positions(bbox)` returning a list of `AISReading`.
The rest of the AIS app reads only from `AISReading` / the protocol, so
swapping providers (Spire, FleetMon, …) is one file.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal


@dataclass
class AISReading:
    mmsi: str
    lat: Decimal
    lng: Decimal
    speed_kn: Decimal | None
    course_deg: int | None
    heading_deg: int | None
    nav_status: str
    reported_at: datetime  # timezone-aware


# bbox = (minlat, maxlat, minlng, maxlng)
BBox = tuple[float, float, float, float]


class AISProvider(ABC):
    @abstractmethod
    def fetch_positions(self, bbox: BBox) -> list[AISReading]:
        """Return all AIS contacts inside the bounding box."""
