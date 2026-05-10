import pytest
from django.core import signing
from apps.portal.member_auth_utils import (
    make_member_magic_token, decode_member_magic_token,
    make_member_session_token, decode_member_session_token,
    make_refresh_token, decode_refresh_token,
)


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
