from datetime import timedelta
from django.utils import timezone
from icalendar import Calendar, Event

from apps.reservations.booking_engine import ACTIVE_STATUSES


def generate_mysea_ical(marina) -> bytes:
    """
    Generate an RFC 5545 iCalendar feed of all blocked dates on mySea-allocated berths.
    Includes:
    - Active bookings on mysea berths
    - Cooldown blocking events for berths in transition
    Returns bytes (UTF-8 encoded .ics content).
    """
    from apps.berths.models import Berth
    from apps.reservations.models import Booking

    now = timezone.now()
    cal = Calendar()
    cal.add('prodid', '-//DocksBase//mySea Channel Feed//EN')
    cal.add('version', '2.0')
    cal.add('calscale', 'GREGORIAN')
    cal.add('method', 'PUBLISH')

    # Active bookings on mySea-allocated berths
    bookings = (
        Booking.objects.filter(
            marina=marina,
            berth__sales_channel='mysea',
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

    # Cooldown blocking events (berths in 30-min transition limbo)
    cooling_berths = Berth.objects.filter(
        marina=marina,
        channel_cooldown_until__gt=now,
    )
    for berth in cooling_berths:
        event = Event()
        event.add('uid', f'cooldown-{berth.pk}@docksbase')
        event.add('dtstamp', now)
        # Block from now until cooldown expires
        event.add('dtstart', now.date())
        event.add('dtend', berth.channel_cooldown_until.date() + timedelta(days=1))
        event.add('summary', f'Cooldown — Berth {berth.code}')
        cal.add_component(event)

    return cal.to_ical()
