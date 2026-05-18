"""End-to-end tests for the cross-marina boater session flow.

Bob signs in via a Marina A magic link. With his new boater token he can:
  - read his Marina A feed/gate/etc.        (same marina as the link)
  - read his Marina B feed/gate/etc.        (different marina, also his)
  - NOT read Marina C anything              (no record there)

Historical access: a `checked_out` Marina B booking still grants context
even if there is no current Member row.
"""
import datetime as _dt

import pytest
from django.core.cache import cache
from django.urls import reverse
from rest_framework.test import APIClient

from apps.portal.boater_session import make_boater_session_token


@pytest.fixture(autouse=True)
def _clear_cache():
    cache.clear()
    yield
    cache.clear()


@pytest.mark.django_db
def test_cross_marina_feed_with_boater_token(marina_factory, member_factory):
    marina_a = marina_factory(slug='marina-a', name='Marina A')
    marina_b = marina_factory(slug='marina-b', name='Marina B')

    # Bob is a member at both marinas.
    member_factory(marina=marina_a, email='bob@example.com')
    member_factory(marina=marina_b, email='bob@example.com')

    token = make_boater_session_token('bob@example.com')
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f'BoaterBearer {token}')

    # Hit Marina A's feed.
    resp_a = client.get(reverse('portal_feed'), HTTP_X_MARINA_SLUG='marina-a')
    assert resp_a.status_code == 200

    # Hit Marina B's feed — same token, different slug.
    resp_b = client.get(reverse('portal_feed'), HTTP_X_MARINA_SLUG='marina-b')
    assert resp_b.status_code == 200


@pytest.mark.django_db
def test_cross_marina_denies_marina_with_no_record(marina_factory, member_factory):
    marina_a = marina_factory(slug='marina-a')
    marina_factory(slug='marina-c', name='Marina C')
    member_factory(marina=marina_a, email='bob@example.com')
    # Bob has NO record at marina-c.

    token = make_boater_session_token('bob@example.com')
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f'BoaterBearer {token}')

    resp = client.get(reverse('portal_feed'), HTTP_X_MARINA_SLUG='marina-c')
    # FeedView returns 404 because no Member resolves — resolver returned None
    # and the view's "Member not found" branch fires. Either way, no data leaks.
    assert resp.status_code in (403, 404)


@pytest.mark.django_db
def test_historical_booking_grants_resolver_access_but_member_views_still_404(
    marina_factory, guest_booking_factory,
):
    """An archived `checked_out` booking with no current Member row:
    - the resolver authorises portal *context* for that marina (200 on
      read-only endpoints that don't require a Member row)
    - member-only endpoints still return 404 because there is no Member row
      to operate on (this is correct — boater can view their invoice via the
      booking, not via a member profile they never had).
    """
    from apps.portal.boater_access import resolve_marina_for_boater
    from apps.portal.boater_session import BoaterUser

    marina_b = marina_factory(slug='marina-b')
    guest_booking_factory(
        marina_b,
        guest_email='bob@example.com',
        status='checked_out',
        check_in=_dt.date(2024, 6, 1),
        check_out=_dt.date(2024, 6, 5),
    )

    # Resolver-level: yes, Bob can see Marina B.
    assert resolve_marina_for_boater(BoaterUser('bob@example.com'), 'marina-b') is not None

    # View-level: no Member row → 404 from FeedView. Action endpoints layer
    # their own status checks; this assertion documents that the resolver
    # ≠ action authorisation.
    token = make_boater_session_token('bob@example.com')
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f'BoaterBearer {token}')
    resp = client.get(reverse('portal_feed'), HTTP_X_MARINA_SLUG='marina-b')
    assert resp.status_code == 404
