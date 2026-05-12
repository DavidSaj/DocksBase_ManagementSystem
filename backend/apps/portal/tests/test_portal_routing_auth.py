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


from django.core import mail as django_mail


@pytest.mark.django_db
def test_request_link_member_only_sends_member_link(member_factory):
    member = member_factory()
    client = Client()
    resp = client.post(
        '/api/v1/portal/auth/request-link/',
        data={'email': member.email},
        content_type='application/json',
        HTTP_X_MARINA_SLUG=member.marina.slug,
    )
    assert resp.status_code == 200
    assert len(django_mail.outbox) == 1
    body = django_mail.outbox[0].body
    assert '?token=m_' in body
    assert '?token=g_' not in body


@pytest.mark.django_db
def test_request_link_guest_only_sends_guest_link(guest_booking_factory, marina_factory):
    marina = marina_factory()
    booking = guest_booking_factory(marina, guest_email='visitor@test.com')
    client = Client()
    resp = client.post(
        '/api/v1/portal/auth/request-link/',
        data={'email': 'visitor@test.com'},
        content_type='application/json',
        HTTP_X_MARINA_SLUG=marina.slug,
    )
    assert resp.status_code == 200
    assert len(django_mail.outbox) == 1
    body = django_mail.outbox[0].body
    assert '?token=g_' in body
    assert '?token=m_' not in body


@pytest.mark.django_db
def test_request_link_multiple_bookings_lists_all(guest_booking_factory, marina_factory):
    import datetime
    marina = marina_factory()
    today = datetime.date.today()
    b1 = guest_booking_factory(marina, guest_email='visitor@test.com',
                                check_in=today, check_out=today + datetime.timedelta(days=2))
    b2 = guest_booking_factory(marina, guest_email='visitor@test.com',
                                check_in=today + datetime.timedelta(days=30),
                                check_out=today + datetime.timedelta(days=33))
    client = Client()
    resp = client.post(
        '/api/v1/portal/auth/request-link/',
        data={'email': 'visitor@test.com'},
        content_type='application/json',
        HTTP_X_MARINA_SLUG=marina.slug,
    )
    assert resp.status_code == 200
    body = django_mail.outbox[0].body
    assert f'BK-{b1.pk}' in body
    assert f'BK-{b2.pk}' in body


@pytest.mark.django_db
def test_request_link_member_and_booking_sends_both(member_factory, guest_booking_factory):
    member = member_factory()
    booking = guest_booking_factory(member.marina, guest_email=member.email)
    client = Client()
    resp = client.post(
        '/api/v1/portal/auth/request-link/',
        data={'email': member.email},
        content_type='application/json',
        HTTP_X_MARINA_SLUG=member.marina.slug,
    )
    assert resp.status_code == 200
    body = django_mail.outbox[0].body
    assert '?token=m_' in body
    assert '?token=g_' in body


@pytest.mark.django_db
def test_request_link_unknown_email_returns_200_no_email(marina_factory):
    marina = marina_factory()
    client = Client()
    resp = client.post(
        '/api/v1/portal/auth/request-link/',
        data={'email': 'nobody@test.com'},
        content_type='application/json',
        HTTP_X_MARINA_SLUG=marina.slug,
    )
    assert resp.status_code == 200
    assert len(django_mail.outbox) == 0


@pytest.mark.django_db
def test_request_link_excludes_past_bookings(guest_booking_factory, marina_factory):
    """Bookings where check_out < today must not generate a link."""
    import datetime
    marina = marina_factory()
    yesterday = datetime.date.today() - datetime.timedelta(days=1)
    guest_booking_factory(
        marina, guest_email='oldguest@test.com',
        check_in=yesterday - datetime.timedelta(days=3),
        check_out=yesterday,
    )
    client = Client()
    resp = client.post(
        '/api/v1/portal/auth/request-link/',
        data={'email': 'oldguest@test.com'},
        content_type='application/json',
        HTTP_X_MARINA_SLUG=marina.slug,
    )
    assert resp.status_code == 200
    assert len(django_mail.outbox) == 0


@pytest.mark.django_db
def test_guest_instant_res_prefix_success(marina_factory):
    from apps.reservations.models import Reservation, ReservationItem
    marina = marina_factory()
    today = datetime.date.today()
    res = Reservation.objects.create(
        marina=marina,
        guest_email='skipper@test.com',
        guest_name='Test Sailor',
        status='confirmed',
    )
    ReservationItem.objects.create(
        reservation=res,
        check_in=today,
        check_out=today + datetime.timedelta(days=3),
        nights=3, status='confirmed',
    )

    client = Client()
    resp = client.post(
        '/api/v1/portal/auth/guest-instant/',
        data={'email': 'skipper@test.com', 'booking_reference': f'RES-{res.pk}'},
        content_type='application/json',
        HTTP_X_MARINA_SLUG=marina.slug,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert 'token' in data
    assert data['reservation_id'] == res.pk
    assert data['marina_slug'] == marina.slug

    from apps.portal.checkin_utils import decode_portal_token
    payload = decode_portal_token(data['token'])
    assert payload['reservation_id'] == res.pk
    assert 'booking_id' not in payload


@pytest.mark.django_db
def test_guest_instant_res_wrong_email_returns_401(marina_factory):
    from apps.reservations.models import Reservation
    marina = marina_factory()
    res = Reservation.objects.create(
        marina=marina, guest_email='real@test.com', status='confirmed',
    )
    client = Client()
    resp = client.post(
        '/api/v1/portal/auth/guest-instant/',
        data={'email': 'wrong@test.com', 'booking_reference': f'RES-{res.pk}'},
        content_type='application/json',
        HTTP_X_MARINA_SLUG=marina.slug,
    )
    assert resp.status_code == 401


def test_make_reservation_magic_url_contains_marina_slug_and_token():
    from apps.portal.checkin_utils import make_reservation_magic_url

    class FakeRes:
        id = 99
        guest_email = 'skipper@test.com'
        class marina:
            slug = 'test-marina'

    url = make_reservation_magic_url(FakeRes())
    assert 'test-marina' in url
    assert '?token=g_' in url


def test_make_reservation_portal_token_decodes_with_reservation_id():
    from apps.portal.checkin_utils import make_reservation_portal_token, decode_portal_token
    token = make_reservation_portal_token(
        reservation_id=42,
        marina_slug='test-marina',
        boater_email='skipper@test.com',
    )
    payload = decode_portal_token(token)
    assert payload['reservation_id'] == 42
    assert 'booking_id' not in payload
