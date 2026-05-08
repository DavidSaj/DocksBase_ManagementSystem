import hashlib
import hmac

from django.conf import settings
from django.utils.dateparse import parse_datetime

from apps.charter.ota.base import CharterBookingData, OTAAdapter


class ClickAndBoatAdapter(OTAAdapter):
    """Adapter for Click&Boat OTA webhook events."""
    channel_name = 'click_and_boat'

    def verify_signature(self, request) -> bool:
        secret = getattr(settings, 'CLICK_AND_BOAT_WEBHOOK_SECRET', '')
        if not secret:
            return getattr(settings, 'DEBUG', False)

        signature_header = request.headers.get('X-Clickandboat-Signature', '')
        if not signature_header:
            return False

        body = request.body
        expected = hmac.new(
            secret.encode('utf-8'),
            body,
            hashlib.sha256,
        ).hexdigest()

        return hmac.compare_digest(expected, signature_header)

    def parse_booking(self, payload: dict) -> CharterBookingData:
        """
        Expected Click&Boat payload shape:
        {
          "id": "CAB-99999",
          "boat_id": "cab-boat-555",
          "departure": "2026-08-01T09:00:00Z",
          "arrival": "2026-08-08T09:00:00Z",
          "renter": {
              "full_name": "...", "email": "...", "phone": "..."
          },
          "commission_rate": 0.18,
          "event": "booking.confirmed"   # or "booking.cancelled"
        }
        """
        renter = payload.get('renter', {})
        event = payload.get('event', '')
        is_cancellation = 'cancel' in event.lower()

        start_dt = parse_datetime(payload.get('departure', ''))
        end_dt   = parse_datetime(payload.get('arrival', ''))

        if not start_dt or not end_dt:
            raise ValueError('Click&Boat payload missing valid departure / arrival dates.')

        return CharterBookingData(
            ota_booking_ref    = str(payload.get('id', '')),
            ota_vessel_id      = str(payload.get('boat_id', '')),
            start_dt           = start_dt,
            end_dt             = end_dt,
            charterer_name     = renter.get('full_name', ''),
            charterer_email    = renter.get('email', ''),
            charterer_phone    = renter.get('phone', ''),
            channel_commission = float(payload.get('commission_rate', 0)),
            is_cancellation    = is_cancellation,
        )
