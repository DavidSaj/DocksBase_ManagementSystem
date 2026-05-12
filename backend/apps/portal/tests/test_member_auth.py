import pytest
from django.test import Client, RequestFactory
from django.core import mail as django_mail, signing
from apps.portal.member_auth_utils import (
    make_member_magic_token, decode_member_magic_token,
    make_member_session_token, decode_member_session_token,
    make_refresh_token, decode_refresh_token,
)
from apps.portal.member_auth import PortalMemberAuthentication, PortalMemberUser
from rest_framework.exceptions import AuthenticationFailed


def test_member_magic_token_roundtrip():
    token = make_member_magic_token(member_id=42, email='alice@test.com')
    payload = decode_member_magic_token(token)
    assert payload['member_id'] == 42
    assert payload['email'] == 'alice@test.com'


def test_member_session_token_roundtrip():
    token = make_member_session_token(member_id=42, marina_slug='portx', email='alice@test.com')
    payload = decode_member_session_token(token)
    assert payload['member_id'] == 42
    assert payload['marina_slug'] == 'portx'
    assert payload['email'] == 'alice@test.com'


def test_refresh_token_roundtrip():
    token = make_refresh_token(member_id=42, marina_slug='portx', email='alice@test.com')
    payload = decode_refresh_token(token)
    assert payload['member_id'] == 42


def test_bad_magic_token_raises():
    with pytest.raises(signing.BadSignature):
        decode_member_magic_token('not-a-valid-token')


def test_bad_session_token_raises():
    with pytest.raises(signing.BadSignature):
        decode_member_session_token('not-a-valid-token')


def test_auth_class_returns_none_without_header():
    factory = RequestFactory()
    request = factory.get('/')
    auth = PortalMemberAuthentication()
    result = auth.authenticate(request)
    assert result is None


def test_auth_class_returns_user_with_valid_token():
    token = make_member_session_token(member_id=7, marina_slug='portx', email='bob@test.com')
    factory = RequestFactory()
    request = factory.get('/', HTTP_AUTHORIZATION=f'MemberBearer {token}')
    auth = PortalMemberAuthentication()
    user, _ = auth.authenticate(request)
    assert isinstance(user, PortalMemberUser)
    assert user.member_id == 7
    assert user.marina_slug == 'portx'


def test_auth_class_raises_on_bad_token():
    factory = RequestFactory()
    request = factory.get('/', HTTP_AUTHORIZATION='MemberBearer invalid-token')
    auth = PortalMemberAuthentication()
    with pytest.raises(AuthenticationFailed):
        auth.authenticate(request)


# ---------------------------------------------------------------------------
# Integration tests — require DB + URL routing
# ---------------------------------------------------------------------------

@pytest.mark.django_db
def test_member_magic_verify_returns_tokens(member_factory):
    from apps.portal.member_auth_utils import make_member_magic_token
    member = member_factory()
    token = make_member_magic_token(member_id=member.id, email=member.email)
    client = Client()
    resp = client.post(
        '/api/v1/portal/auth/member-magic/verify/',
        data={'token': token},
        content_type='application/json',
    )
    assert resp.status_code == 200
    data = resp.json()
    assert 'session_token' in data
    assert 'refresh_token' in data
    assert data['marina_slug'] == member.marina.slug


@pytest.mark.django_db
def test_member_magic_refresh_returns_new_tokens(member_factory):
    from apps.portal.member_auth_utils import make_refresh_token
    member = member_factory()
    refresh = make_refresh_token(
        member_id=member.id, marina_slug=member.marina.slug, email=member.email
    )
    client = Client()
    resp = client.post(
        '/api/v1/portal/auth/member-magic/refresh/',
        data={'refresh_token': refresh},
        content_type='application/json',
    )
    assert resp.status_code == 200
    data = resp.json()
    assert 'session_token' in data
    assert 'refresh_token' in data


