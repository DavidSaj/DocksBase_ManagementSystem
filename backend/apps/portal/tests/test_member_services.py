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
