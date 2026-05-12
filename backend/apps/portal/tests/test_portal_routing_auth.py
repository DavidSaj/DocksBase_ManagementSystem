import datetime
import pytest
from django.test import Client


@pytest.mark.django_db
def test_guest_instant_success(guest_booking_factory, marina_factory):
    marina = marina_factory()
    today = datetime.date.today()
    booking = guest_booking_factory(
        marina,
        check_in=today,
        check_out=today + datetime.timedelta(days=3),
        guest_email='skipper@test.com',
    )
    client = Client()
    resp = client.post(
        '/api/v1/portal/auth/guest-instant/',
        data={'email': 'skipper@test.com', 'booking_reference': f'BK-{booking.pk}'},
        content_type='application/json',
        HTTP_X_MARINA_SLUG=marina.slug,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert 'token' in data
    assert data['booking_id'] == booking.pk
    assert data['marina_slug'] == marina.slug


@pytest.mark.django_db
def test_guest_instant_case_insensitive_email(guest_booking_factory, marina_factory):
    marina = marina_factory()
    today = datetime.date.today()
    booking = guest_booking_factory(marina, guest_email='Skipper@Test.com')
    client = Client()
    resp = client.post(
        '/api/v1/portal/auth/guest-instant/',
        data={'email': 'skipper@test.com', 'booking_reference': f'BK-{booking.pk}'},
        content_type='application/json',
        HTTP_X_MARINA_SLUG=marina.slug,
    )
    assert resp.status_code == 200


@pytest.mark.django_db
def test_guest_instant_wrong_email_returns_401(guest_booking_factory, marina_factory):
    marina = marina_factory()
    booking = guest_booking_factory(marina, guest_email='real@test.com')
    client = Client()
    resp = client.post(
        '/api/v1/portal/auth/guest-instant/',
        data={'email': 'wrong@test.com', 'booking_reference': f'BK-{booking.pk}'},
        content_type='application/json',
        HTTP_X_MARINA_SLUG=marina.slug,
    )
    assert resp.status_code == 401


@pytest.mark.django_db
def test_guest_instant_invalid_ref_format_returns_401(guest_booking_factory, marina_factory):
    marina = marina_factory()
    client = Client()
    resp = client.post(
        '/api/v1/portal/auth/guest-instant/',
        data={'email': 'guest@test.com', 'booking_reference': 'NOTAREF'},
        content_type='application/json',
        HTTP_X_MARINA_SLUG=marina.slug,
    )
    assert resp.status_code == 401


@pytest.mark.django_db
def test_guest_instant_member_email_gets_scoped_guest_token(
    guest_booking_factory, member_factory
):
    """Member email + booking ref always issues a guest-scoped token, not member access."""
    member = member_factory()
    booking = guest_booking_factory(member.marina, guest_email=member.email)
    client = Client()
    resp = client.post(
        '/api/v1/portal/auth/guest-instant/',
        data={'email': member.email, 'booking_reference': f'BK-{booking.pk}'},
        content_type='application/json',
        HTTP_X_MARINA_SLUG=member.marina.slug,
    )
    assert resp.status_code == 200
    # Token must decode as a guest portal token (not a member session token)
    from apps.portal.checkin_utils import decode_portal_token
    data = resp.json()
    payload = decode_portal_token(data['token'])
    assert payload['booking_id'] == booking.pk
