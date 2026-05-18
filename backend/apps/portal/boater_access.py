"""Per-request resolver: does this boater have access to view a marina?

A boater can view a marina iff **any** Booking / Reservation / Member record
exists for `(email, slug)`, regardless of status. Past stays, cancelled
bookings, and archived members all qualify — a boater retrieving a 2024 tax
invoice must not 403.

Action endpoints (open gate, request extension, check-in) layer their own
status checks on top. This resolver gates *context*, not actions.

Cached in the Django cache framework (Redis in prod, LocMem in tests) under
`portal:boater_access:{sha256(email)}:{slug}` with a 30-minute TTL. Cache is
invalidated by `signals.py` when a Booking / Reservation / Member row is
created for that (email, slug) pair — status changes do NOT invalidate, since
access doesn't depend on status.
"""
import hashlib

from django.core.cache import cache

ACCESS_CACHE_TTL = 30 * 60  # 30 minutes


def _key(email, slug):
    if not email or not slug:
        return None
    email_hash = hashlib.sha256(email.strip().lower().encode()).hexdigest()
    return f'portal:boater_access:{email_hash}:{slug}'


def _query_has_access(email, slug):
    """DB-truth lookup. Imports inside the function to avoid app-loading order issues."""
    from apps.accounts.models import Marina
    from apps.members.models import Member
    from apps.reservations.models import Booking, Reservation

    marina = Marina.objects.filter(slug=slug).first()
    if marina is None:
        return None

    has_booking = Booking.objects.filter(
        guest_email__iexact=email, marina=marina,
    ).exists()
    if has_booking:
        return marina

    has_reservation = Reservation.objects.filter(
        guest_email__iexact=email, marina=marina,
    ).exists()
    if has_reservation:
        return marina

    has_member = Member.objects.filter(
        email__iexact=email, marina=marina,
    ).exists()
    if has_member:
        return marina

    return None


def resolve_marina_for_boater(user, slug):
    """Returns the Marina iff `user.email` has any record at `slug`, else None.

    Result is cached for ACCESS_CACHE_TTL seconds. Positive AND negative
    results are cached — a "no" answer is also valuable and equally bounded by
    the create-time invalidation in signals.py.
    """
    email = (getattr(user, 'email', None) or '').strip().lower()
    if not email or not slug:
        return None

    cache_key = _key(email, slug)
    cached = cache.get(cache_key)
    if cached == 'NO_ACCESS':
        return None
    if cached is not None:
        # Cached "yes" — re-fetch the marina row (cheap, indexed by slug).
        from apps.accounts.models import Marina
        return Marina.objects.filter(slug=slug).first()

    marina = _query_has_access(email, slug)
    if marina is None:
        cache.set(cache_key, 'NO_ACCESS', ACCESS_CACHE_TTL)
    else:
        cache.set(cache_key, 'YES', ACCESS_CACHE_TTL)
    return marina


def invalidate_boater_access(email, slug):
    """Bust the cache entry for (email, slug). Called from signals on row create."""
    cache_key = _key(email, slug)
    if cache_key:
        cache.delete(cache_key)
