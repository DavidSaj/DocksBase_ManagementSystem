from datetime import timedelta
from django.utils import timezone
from icalendar import Calendar, Event

from apps.reservations.booking_engine import ACTIVE_STATUSES


def generate_ota_ical(connection) -> bytes:
    """
    Generate an RFC 5545 iCalendar feed of all active bookings on berths
    assigned to the given OTAConnection. Used for outbound feed to the OTA partner.
    Returns bytes (UTF-8 encoded .ics content).
    """
    from apps.reservations.models import Booking

    now = timezone.now()
    cal = Calendar()
    cal.add('prodid', '-//DocksBase//OTA Channel Feed//EN')
    cal.add('version', '2.0')
    cal.add('calscale', 'GREGORIAN')
    cal.add('method', 'PUBLISH')

    bookings = (
        Booking.objects.filter(
            marina=connection.marina,
            berth__ota_connection=connection,
            status__in=ACTIVE_STATUSES,
        )
        .select_related('berth')
    )

    for booking in bookings:
        event = Event()
        event.add('uid', f'booking-{booking.pk}@docksbase')
        event.add('dtstamp', now)
        event.add('dtstart', booking.check_in)
        event.add('dtend', booking.check_out)
        summary = booking.guest_name or (f'LOA {booking.boat_loa}m' if booking.boat_loa else 'Reserved')
        event.add('summary', summary)
        cal.add_component(event)

    return cal.to_ical()
