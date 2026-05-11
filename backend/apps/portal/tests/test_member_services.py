# backend/apps/portal/tests/test_member_services.py
import pytest
import datetime as dt
from django.test import Client
from apps.portal.member_auth_utils import make_member_session_token


def _auth_headers(member):
    token = make_member_session_token(
        member_id=member.id,
        marina_slug=member.marina.slug,
        email=member.email,
    )
    return {
        'HTTP_AUTHORIZATION': f'MemberBearer {token}',
        'HTTP_X_MARINA_SLUG': member.marina.slug,
    }


# ── Crane Request ──────────────────────────────────────────────────────────

@pytest.mark.django_db
def test_crane_requires_auth():
    client = Client()
    resp = client.post(
        '/api/v1/portal/member/crane-requests/',
        {},
        content_type='application/json',
    )
    assert resp.status_code in (401, 403)


@pytest.mark.django_db
def test_crane_creates_record(member_factory):
    member = member_factory()
    tomorrow = (dt.date.today() + dt.timedelta(days=1)).isoformat()
    resp = Client().post(
        '/api/v1/portal/member/crane-requests/',
        {'service_type': 'launch', 'requested_date': tomorrow},
        content_type='application/json',
        **_auth_headers(member),
    )
    assert resp.status_code == 201
    assert resp.json()['status'] == 'requested'


@pytest.mark.django_db
def test_crane_rejects_invalid_service_type(member_factory):
    member = member_factory()
    tomorrow = (dt.date.today() + dt.timedelta(days=1)).isoformat()
    resp = Client().post(
        '/api/v1/portal/member/crane-requests/',
        {'service_type': 'invalid', 'requested_date': tomorrow},
        content_type='application/json',
        **_auth_headers(member),
    )
    assert resp.status_code == 400


@pytest.mark.django_db
def test_crane_rejects_missing_date(member_factory):
    member = member_factory()
    resp = Client().post(
        '/api/v1/portal/member/crane-requests/',
        {'service_type': 'launch'},
        content_type='application/json',
        **_auth_headers(member),
    )
    assert resp.status_code == 400


@pytest.mark.django_db
def test_crane_rejects_invalid_date_string(member_factory):
    member = member_factory()
    resp = Client().post(
        '/api/v1/portal/member/crane-requests/',
        {'service_type': 'launch', 'requested_date': 'not-a-date', 'notes': ''},
        content_type='application/json',
        **_auth_headers(member),
    )
    assert resp.status_code == 400
    assert 'requested_date' in resp.json()['detail']


@pytest.mark.django_db
def test_crane_null_notes_succeeds(member_factory):
    member = member_factory()
    resp = Client().post(
        '/api/v1/portal/member/crane-requests/',
        {'service_type': 'launch', 'requested_date': '2026-07-01', 'notes': None},
        content_type='application/json',
        **_auth_headers(member),
    )
    assert resp.status_code == 201
    assert resp.json()['status'] == 'requested'


# ── Extend Stay ────────────────────────────────────────────────────────────

@pytest.mark.django_db
def test_booking_view_returns_current_booking(member_factory, booking_factory):
    member = member_factory()
    booking_factory(member)
    resp = Client().get(
        '/api/v1/portal/member/booking/',
        **_auth_headers(member),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert 'check_out' in data
    assert 'berth_id' in data


@pytest.mark.django_db
def test_booking_view_404_when_no_booking(member_factory):
    member = member_factory()
    resp = Client().get(
        '/api/v1/portal/member/booking/',
        **_auth_headers(member),
    )
    assert resp.status_code == 404


@pytest.mark.django_db
def test_extend_stay_check_available(member_factory, booking_factory):
    import datetime as _dt
    member = member_factory()
    booking = booking_factory(member)
    new_check_out = (booking.check_out + _dt.timedelta(days=3)).isoformat()
    resp = Client().get(
        f'/api/v1/portal/member/extend-stay/?new_check_out={new_check_out}',
        **_auth_headers(member),
    )
    assert resp.status_code == 200
    assert resp.json()['available'] is True


@pytest.mark.django_db
def test_extend_stay_check_unavailable(member_factory, booking_factory):
    import datetime as _dt
    member = member_factory()
    booking = booking_factory(member)
    new_check_out = (booking.check_out + _dt.timedelta(days=3)).isoformat()
    from apps.reservations.models import Booking as B
    B.objects.create(
        marina=member.marina,
        berth=booking.berth,
        check_in=booking.check_out,
        check_out=new_check_out,
        status='confirmed',
    )
    resp = Client().get(
        f'/api/v1/portal/member/extend-stay/?new_check_out={new_check_out}',
        **_auth_headers(member),
    )
    assert resp.status_code == 200
    assert resp.json()['available'] is False


@pytest.mark.django_db
def test_extend_stay_post_creates_booking(member_factory, booking_factory):
    import datetime as _dt
    member = member_factory()
    booking = booking_factory(member)
    new_check_out = (booking.check_out + _dt.timedelta(days=3)).isoformat()
    resp = Client().post(
        '/api/v1/portal/member/extend-stay/',
        {'new_check_out': new_check_out},
        content_type='application/json',
        **_auth_headers(member),
    )
    assert resp.status_code == 201
    assert 'id' in resp.json()


@pytest.mark.django_db
def test_extend_stay_post_409_on_conflict(member_factory, booking_factory):
    import datetime as _dt
    member = member_factory()
    booking = booking_factory(member)
    new_check_out = (booking.check_out + _dt.timedelta(days=3)).isoformat()
    from apps.reservations.models import Booking as B
    B.objects.create(
        marina=member.marina,
        berth=booking.berth,
        check_in=booking.check_out,
        check_out=new_check_out,
        status='confirmed',
    )
    resp = Client().post(
        '/api/v1/portal/member/extend-stay/',
        {'new_check_out': new_check_out},
        content_type='application/json',
        **_auth_headers(member),
    )
    assert resp.status_code == 409


# ── Report Issue ───────────────────────────────────────────────────────────

@pytest.mark.django_db
def test_issue_requires_auth():
    resp = Client().post(
        '/api/v1/portal/member/issues/',
        {},
        content_type='application/json',
    )
    assert resp.status_code in (401, 403)


@pytest.mark.django_db
def test_issue_creates_work_order(member_factory):
    member = member_factory()
    resp = Client().post(
        '/api/v1/portal/member/issues/',
        {'category': 'berth', 'description': 'Cleat is broken.'},
        content_type='application/json',
        **_auth_headers(member),
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data['ref'].startswith('WO-')


@pytest.mark.django_db
def test_issue_rejects_invalid_category(member_factory):
    member = member_factory()
    resp = Client().post(
        '/api/v1/portal/member/issues/',
        {'category': 'not_a_category', 'description': 'Something broke.'},
        content_type='application/json',
        **_auth_headers(member),
    )
    assert resp.status_code == 400


@pytest.mark.django_db
def test_issue_rejects_empty_description(member_factory):
    member = member_factory()
    resp = Client().post(
        '/api/v1/portal/member/issues/',
        {'category': 'facility', 'description': '   '},
        content_type='application/json',
        **_auth_headers(member),
    )
    assert resp.status_code == 400
