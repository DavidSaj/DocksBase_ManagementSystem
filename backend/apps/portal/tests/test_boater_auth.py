"""DRF integration tests for BoaterTokenAuthentication."""
import pytest
from rest_framework.test import APIRequestFactory
from rest_framework.exceptions import AuthenticationFailed

from apps.portal.boater_auth import BoaterTokenAuthentication
from apps.portal.boater_session import make_boater_session_token


def _auth_request(header_value):
    factory = APIRequestFactory()
    req = factory.get('/')
    if header_value is not None:
        req.META['HTTP_AUTHORIZATION'] = header_value
    return req


def test_authenticates_with_valid_boater_token():
    token = make_boater_session_token('bob@example.com')
    auth = BoaterTokenAuthentication()
    user, _ = auth.authenticate(_auth_request(f'BoaterBearer {token}'))
    assert user.email == 'bob@example.com'
    assert user.is_authenticated


def test_returns_none_for_other_schemes():
    """Bearer / MemberBearer must fall through to legacy auth classes."""
    auth = BoaterTokenAuthentication()
    assert auth.authenticate(_auth_request('Bearer abc.def')) is None
    assert auth.authenticate(_auth_request('MemberBearer abc.def')) is None
    assert auth.authenticate(_auth_request(None)) is None


def test_rejects_tampered_token():
    token = make_boater_session_token('bob@example.com')
    tampered = token[:-2] + ('AA' if not token.endswith('AA') else 'BB')
    auth = BoaterTokenAuthentication()
    with pytest.raises(AuthenticationFailed):
        auth.authenticate(_auth_request(f'BoaterBearer {tampered}'))
