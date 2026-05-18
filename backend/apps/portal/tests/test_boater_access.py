"""Resolver + cache tests for the boater-access helper.

Covers:
- positive lookup for any record (Booking, Reservation, Member)
- historical access — status-agnostic
- negative lookup → 403-equivalent (None)
- cache shields the DB after the first call
- create-time signal invalidates the negative cache
"""
import datetime as _dt

import pytest
from django.core.cache import cache
from django.db import connection
from django.test.utils import CaptureQueriesContext

from apps.portal.boater_access import resolve_marina_for_boater
from apps.portal.boater_session import BoaterUser


@pytest.fixture(autouse=True)
def _clear_cache():
    cache.clear()
    yield
    cache.clear()


@pytest.mark.django_db
def test_resolver_grants_access_via_active_booking(marina_factory, guest_booking_factory):
    marina = marina_factory(slug='marina-a')
    guest_booking_factory(marina, guest_email='bob@example.com')

    result = resolve_marina_for_boater(BoaterUser('bob@example.com'), 'marina-a')
    assert result is not None
    assert result.slug == 'marina-a'


@pytest.mark.django_db
def test_resolver_grants_access_for_checked_out_booking(marina_factory, guest_booking_factory):
    """Historical-access principle: a `checked_out` 2024 stay must still grant
    portal context so the boater can fetch their tax invoice."""
    marina = marina_factory(slug='marina-b')
    guest_booking_factory(
        marina,
        guest_email='bob@example.com',
        status='checked_out',
        check_in=_dt.date(2024, 6, 1),
        check_out=_dt.date(2024, 6, 5),
    )

    result = resolve_marina_for_boater(BoaterUser('bob@example.com'), 'marina-b')
    assert result is not None


@pytest.mark.django_db
def test_resolver_grants_access_for_cancelled_booking(marina_factory, guest_booking_factory):
    """Even cancelled rows count for access — the boater still needs to see
    their cancellation receipt or refund status."""
    marina = marina_factory(slug='marina-c')
    guest_booking_factory(marina, guest_email='bob@example.com', status='cancelled')

    result = resolve_marina_for_boater(BoaterUser('bob@example.com'), 'marina-c')
    assert result is not None


@pytest.mark.django_db
def test_resolver_grants_access_via_member_row(marina_factory, member_factory):
    marina = marina_factory(slug='marina-d')
    member_factory(marina=marina, email='bob@example.com')

    result = resolve_marina_for_boater(BoaterUser('bob@example.com'), 'marina-d')
    assert result is not None


@pytest.mark.django_db
def test_resolver_denies_with_no_record(marina_factory):
    marina_factory(slug='marina-e')

    result = resolve_marina_for_boater(BoaterUser('alice@example.com'), 'marina-e')
    assert result is None


@pytest.mark.django_db
def test_resolver_returns_none_for_unknown_slug():
    result = resolve_marina_for_boater(BoaterUser('bob@example.com'), 'no-such-marina')
    assert result is None


@pytest.mark.django_db
def test_resolver_caches_positive_result(marina_factory, guest_booking_factory):
    marina = marina_factory(slug='marina-f')
    guest_booking_factory(marina, guest_email='bob@example.com')

    user = BoaterUser('bob@example.com')

    # Warm the cache.
    resolve_marina_for_boater(user, 'marina-f')

    # Second call should only touch the Marina table (the post-cache re-fetch),
    # not the three EXISTS queries the resolver runs against Booking/Reservation/Member.
    with CaptureQueriesContext(connection) as ctx:
        resolve_marina_for_boater(user, 'marina-f')
    queries = [q['sql'].lower() for q in ctx.captured_queries]
    # No EXISTS on the access tables on the cached hit.
    joined = '\n'.join(queries)
    assert 'reservations_booking' not in joined
    assert 'reservations_reservation' not in joined
    assert 'members_member' not in joined


@pytest.mark.django_db
def test_resolver_caches_negative_result(marina_factory):
    marina_factory(slug='marina-g')
    user = BoaterUser('alice@example.com')

    # First call: negative lookup hits the DB.
    resolve_marina_for_boater(user, 'marina-g')

    # Second call: cached "NO_ACCESS" — must NOT touch the access tables, and
    # also must NOT re-fetch the Marina row.
    with CaptureQueriesContext(connection) as ctx:
        result = resolve_marina_for_boater(user, 'marina-g')
    assert result is None
    assert len(ctx.captured_queries) == 0


@pytest.mark.django_db
def test_negative_cache_invalidated_on_booking_create(marina_factory, guest_booking_factory):
    marina = marina_factory(slug='marina-h')
    user = BoaterUser('bob@example.com')

    # Initial state: no access.
    assert resolve_marina_for_boater(user, 'marina-h') is None

    # Create a booking — the post_save signal should bust the negative cache.
    guest_booking_factory(marina, guest_email='bob@example.com')

    # Now access should resolve without needing manual cache.clear().
    result = resolve_marina_for_boater(user, 'marina-h')
    assert result is not None
    assert result.slug == 'marina-h'


@pytest.mark.django_db
def test_resolver_returns_none_for_anonymous_user():
    class Anon:
        email = ''
    assert resolve_marina_for_boater(Anon(), 'marina-a') is None
    assert resolve_marina_for_boater(BoaterUser(''), 'marina-a') is None
