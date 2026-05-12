import datetime
from zoneinfo import ZoneInfo
from django.core import signing
from django.conf import settings

MAGIC_SALT = 'portal-magic-v1'
SESSION_SALT = 'portal-session-v1'
MAGIC_MAX_AGE = 60 * 60 * 72    # 72 hours
SESSION_MAX_AGE = 60 * 60 * 24 * 7  # 7 days


def evaluate_pre_cleared(booking):
    if booking.pre_cleared:
        return
    if (booking.waiver_signed
            and booking.boat_loa is not None
            and booking.boat_beam is not None
            and booking.boat_draft is not None):
        booking.pre_cleared = True
        booking.save(update_fields=['pre_cleared'])


def make_magic_token(booking_id, boater_email):
    return signing.dumps(
        {'booking_id': booking_id, 'boater_email': boater_email},
        salt=MAGIC_SALT,
    )


def decode_magic_token(token):
    return signing.loads(token, salt=MAGIC_SALT, max_age=MAGIC_MAX_AGE)


def make_portal_token(booking_id, marina_slug, boater_email):
    return signing.dumps(
        {'booking_id': booking_id, 'marina_slug': marina_slug, 'boater_email': boater_email},
        salt=SESSION_SALT,
    )


def decode_portal_token(token):
    return signing.loads(token, salt=SESSION_SALT, max_age=SESSION_MAX_AGE)


def make_magic_url(booking):
    token = make_magic_token(booking.id, booking.guest_email)
    base = getattr(settings, 'PORTAL_BASE_URL', 'https://book.docksbase.com')
    return f"{base}/{booking.marina.slug}?token=g_{token}"


def make_reservation_magic_token(reservation_id, boater_email):
    return signing.dumps(
        {'reservation_id': reservation_id, 'boater_email': boater_email},
        salt=MAGIC_SALT,
    )


def make_reservation_magic_url(reservation):
    token = make_reservation_magic_token(reservation.id, reservation.guest_email)
    base = getattr(settings, 'PORTAL_BASE_URL', 'https://book.docksbase.com')
    return f"{base}/{reservation.marina.slug}?token=g_{token}"


def make_reservation_portal_token(reservation_id, marina_slug, boater_email):
    return signing.dumps(
        {'reservation_id': reservation_id, 'marina_slug': marina_slug, 'boater_email': boater_email},
        salt=SESSION_SALT,
    )


def is_arrival_day(booking):
    try:
        tz = ZoneInfo(booking.marina.timezone or 'UTC')
    except KeyError:
        tz = ZoneInfo('UTC')
    today_local = datetime.datetime.now(tz).date()
    return booking.check_in == today_local
