import hashlib
import hmac

from django.conf import settings
from django.utils.dateparse import parse_datetime

from apps.charter.ota.base import CharterBookingData, OTAAdapter


class ZizooAdapter(OTAAdapter):
    """Adapter for Zizoo OTA webhook events."""
    channel_name = 'zizoo'

    def verify_signature(self, request) -> bool:
        secret = getattr(settings, 'ZIZOO_WEBHOOK_SECRET', '')
        if not secret:
            # In production this must be set; fail open only in dev
            return getattr(settings, 'DEBUG', False)

        signature_header = request.headers.get('X-Zizoo-Signature', '')
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
        Expected Zizoo payload shape:
        {
          "booking_id": "ZIZ-12345",
          "vessel_id": "zizoo-vessel-999",
          "start_date": "2026-07-01T10:00:00Z",
          "end_date": "2026-07-08T10:00:00Z",
          "charterer": {
              "name": "...", "email": "...", "phone": "..."
          },
          "commission": 0.15,
          "status": "confirmed"   # or "cancelled"
        }
        """
        charterer = payload.get('charterer', {})
        is_cancellation = payload.get('status', '').lower() == 'cancelled'

        start_dt = parse_datetime(payload.get('start_date', ''))
        end_dt   = parse_datetime(payload.get('end_date', ''))

        if not start_dt or not end_dt:
            raise ValueError('Zizoo payload missing valid start_date / end_date.')

        return CharterBookingData(
            ota_booking_ref    = str(payload.get('booking_id', '')),
            ota_vessel_id      = str(payload.get('vessel_id', '')),
            start_dt           = start_dt,
            end_dt             = end_dt,
            charterer_name     = charterer.get('name', ''),
            charterer_email    = charterer.get('email', ''),
            charterer_phone    = charterer.get('phone', ''),
            channel_commission = float(payload.get('commission', 0)),
            is_cancellation    = is_cancellation,
        )
