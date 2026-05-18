"""Tests for the cross-marina /api/portal/my-trips/ endpoint."""
import datetime as _dt

import pytest
from django.urls import reverse
from rest_framework.test import APIClient

from apps.portal.checkin_utils import make_portal_token
from apps.portal.member_auth_utils import make_member_session_token


@pytest.mark.django_db
def test_my_trips_aggregates_bookings_across_marinas(marina_factory, guest_booking_factory):
    marina_a = marina_factory(slug='marina-a', name='Marina A')
    marina_b = marina_factory(slug='marina-b', name='Marina B')

    today = _dt.date.today()
    bk_a = guest_booking_factory(
        marina_a,
        guest_email='bob@example.com',
        check_in=today + _dt.timedelta(days=10),
        check_out=today + _dt.timedelta(days=12),
    )
    bk_b = guest_booking_factory(
        marina_b,
        guest_email='bob@example.com',
        check_in=today + _dt.timedelta(days=3),
        check_out=today + _dt.timedelta(days=5),
    )
    # Other boater — must NOT appear.
    guest_booking_factory(marina_a, guest_email='alice@example.com')

    token = make_portal_token(bk_a.id, marina_a.slug, 'bob@example.com')
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')

    resp = client.get(reverse('portal_my_trips'))
    assert resp.status_code == 200, resp.content

    data = resp.json()
    assert data['email'] == 'bob@example.com'
    refs = [t['ref'] for t in data['trips']]
    assert f'BK-{bk_a.id}' in refs
    assert f'BK-{bk_b.id}' in refs
    assert len(data['trips']) == 2

    # Marina-b trip is sooner, should sort first under upcoming-asc.
    assert data['trips'][0]['ref'] == f'BK-{bk_b.id}'
    assert data['counts']['upcoming'] == 2
    assert data['counts']['past'] == 0


@pytest.mark.django_db
def test_my_trips_excludes_cancelled(marina_factory, guest_booking_factory):
    marina = marina_factory()
    today = _dt.date.today()
    live = guest_booking_factory(
        marina, guest_email='bob@example.com',
        check_in=today + _dt.timedelta(days=1),
        check_out=today + _dt.timedelta(days=2),
    )
    guest_booking_factory(
        marina, guest_email='bob@example.com',
        status='cancelled',
        check_in=today + _dt.timedelta(days=1),
        check_out=today + _dt.timedelta(days=2),
    )

    token = make_portal_token(live.id, marina.slug, 'bob@example.com')
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')

    resp = client.get(reverse('portal_my_trips'))
    assert resp.status_code == 200
    refs = [t['ref'] for t in resp.json()['trips']]
    assert refs == [f'BK-{live.id}']


@pytest.mark.django_db
def test_my_trips_accepts_member_token(marina_factory, member_factory, guest_booking_factory):
    marina = marina_factory()
    member = member_factory(marina=marina, email='member@example.com')
    today = _dt.date.today()
    bk = guest_booking_factory(
        marina, guest_email='member@example.com',
        check_in=today + _dt.timedelta(days=1),
        check_out=today + _dt.timedelta(days=2),
    )

    token = make_member_session_token(member.id, marina.slug, member.email)
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f'MemberBearer {token}')

    resp = client.get(reverse('portal_my_trips'))
    assert resp.status_code == 200
    refs = [t['ref'] for t in resp.json()['trips']]
    assert refs == [f'BK-{bk.id}']


@pytest.mark.django_db
def test_my_trips_requires_auth():
    client = APIClient()
    resp = client.get(reverse('portal_my_trips'))
    assert resp.status_code in (401, 403)


@pytest.mark.django_db
def test_my_trips_separates_upcoming_and_past(marina_factory, guest_booking_factory):
    marina = marina_factory()
    today = _dt.date.today()
    past = guest_booking_factory(
        marina, guest_email='bob@example.com',
        check_in=today - _dt.timedelta(days=20),
        check_out=today - _dt.timedelta(days=15),
        status='checked_out',
    )
    upcoming = guest_booking_factory(
        marina, guest_email='bob@example.com',
        check_in=today + _dt.timedelta(days=5),
        check_out=today + _dt.timedelta(days=7),
    )

    token = make_portal_token(upcoming.id, marina.slug, 'bob@example.com')
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')

    resp = client.get(reverse('portal_my_trips'))
    data = resp.json()
    assert data['counts'] == {'upcoming': 1, 'past': 1}
    # Upcoming first, then past.
    assert data['trips'][0]['ref'] == f'BK-{upcoming.id}'
    assert data['trips'][1]['ref'] == f'BK-{past.id}'
