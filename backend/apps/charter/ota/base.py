from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional


@dataclass
class CharterBookingData:
    ota_booking_ref:    str
    ota_vessel_id:      str
    start_dt:           datetime
    end_dt:             datetime
    charterer_name:     str
    charterer_email:    str
    charterer_phone:    str
    channel_commission: float
    is_cancellation:    bool = False


class OTAAdapter:
    """Abstract base for OTA webhook adapters."""
    channel_name: str = ''

    def verify_signature(self, request) -> bool:
        """Verify the request came from the OTA. Return True if valid."""
        raise NotImplementedError

    def parse_booking(self, payload: dict) -> CharterBookingData:
        """Parse the OTA payload into a CharterBookingData."""
        raise NotImplementedError

    def map_vessel(self, ota_vessel_id: str, marina) -> 'CharterVessel | None':
        """Look up the local CharterVessel for the given OTA vessel ID."""
        from apps.charter.models import CharterVesselOTAMapping
        mapping = CharterVesselOTAMapping.objects.filter(
            channel=self.channel_name,
            ota_vessel_id=ota_vessel_id,
            marina=marina,
        ).select_related('charter_vessel').first()
        return mapping.charter_vessel if mapping else None
