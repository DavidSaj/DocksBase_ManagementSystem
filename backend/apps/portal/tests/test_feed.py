# backend/apps/portal/tests/test_feed.py
import pytest
from django.test import Client
from apps.portal.member_auth_utils import make_member_session_token


@pytest.mark.django_db
def test_feed_requires_auth():
    client = Client()
    resp = client.get('/api/v1/portal/feed/')
    assert resp.status_code in (401, 403)


@pytest.mark.django_db
def test_feed_returns_list(member_factory):
    member = member_factory()
    token = make_member_session_token(
        member_id=member.id, marina_slug=member.marina.slug, email=member.email
    )
    client = Client()
    resp = client.get(
        '/api/v1/portal/feed/',
        HTTP_AUTHORIZATION=f'MemberBearer {token}',
        HTTP_X_MARINA_SLUG=member.marina.slug,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)


@pytest.mark.django_db
def test_feed_includes_overdue_invoice(member_factory, invoice_factory):
    import datetime
    member = member_factory()
    invoice_factory(
        member=member,
        marina=member.marina,
        status='unpaid',
        due_date=datetime.date.today() - datetime.timedelta(days=5),
    )
    token = make_member_session_token(
        member_id=member.id, marina_slug=member.marina.slug, email=member.email
    )
    client = Client()
    resp = client.get(
        '/api/v1/portal/feed/',
        HTTP_AUTHORIZATION=f'MemberBearer {token}',
        HTTP_X_MARINA_SLUG=member.marina.slug,
    )
    data = resp.json()
    types = [item['type'] for item in data]
    assert 'invoice_overdue' in types


@pytest.mark.django_db
def test_feed_sorted_by_priority(member_factory, invoice_factory):
    """Overdue invoices (priority 10) must appear before vessel status (priority 20)."""
    import datetime
    member = member_factory()
    invoice_factory(
        member=member,
        marina=member.marina,
        status='unpaid',
        due_date=datetime.date.today() - datetime.timedelta(days=1),
    )
    token = make_member_session_token(
        member_id=member.id, marina_slug=member.marina.slug, email=member.email
    )
    client = Client()
    resp = client.get(
        '/api/v1/portal/feed/',
        HTTP_AUTHORIZATION=f'MemberBearer {token}',
        HTTP_X_MARINA_SLUG=member.marina.slug,
    )
    data = resp.json()
    priorities = [item['priority'] for item in data]
    assert priorities == sorted(priorities)
