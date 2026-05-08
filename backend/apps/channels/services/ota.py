def handle_ota_webhook(channel, payload):
    """
    Process an inbound OTA webhook payload.
    Parses bookings from the payload and imports each one idempotently.
    """
    from apps.channels.ota.factory import get_adapter
    adapter = get_adapter(channel)
    raw_bookings = adapter.parse_webhook_payload(payload)
    results = []
    for raw in raw_bookings:
        ota_booking = import_ota_booking(channel, raw)
        results.append(ota_booking)
    return results


def import_ota_booking(channel, raw_booking):
    """
    Import a single raw OTA booking dict with idempotency guard.
    Returns the OTABooking instance (created or existing).
    """
    from apps.channels.models import OTABooking

    ota_ref = raw_booking.get('id') or raw_booking.get('ref') or raw_booking.get('ota_ref', '')
    if not ota_ref:
        raise ValueError('OTA booking has no identifiable ref field')

    ota_booking, created = OTABooking.objects.get_or_create(
        channel=channel,
        ota_ref=str(ota_ref),
        defaults={
            'raw_payload': raw_booking,
            'commission_pct': raw_booking.get('commission_pct', 0),
            'commission_amount': raw_booking.get('commission_amount', 0),
        },
    )

    if not created:
        # Update raw payload in case of re-delivery
        ota_booking.raw_payload = raw_booking
        ota_booking.save(update_fields=['raw_payload'])

    return ota_booking
