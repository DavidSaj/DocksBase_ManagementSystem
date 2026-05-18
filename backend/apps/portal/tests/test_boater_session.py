"""Round-trip tests for boater session/refresh tokens."""
import pytest
from django.core import signing

from apps.portal.boater_session import (
    BoaterUser,
    decode_boater_refresh_token,
    decode_boater_session_token,
    make_boater_refresh_token,
    make_boater_session_token,
)


def test_session_token_roundtrip():
    token = make_boater_session_token('bob@example.com')
    payload = decode_boater_session_token(token)
    assert payload == {'email': 'bob@example.com', 'type': 'boater'}


def test_refresh_token_roundtrip():
    token = make_boater_refresh_token('bob@example.com')
    payload = decode_boater_refresh_token(token)
    assert payload == {'email': 'bob@example.com', 'type': 'boater'}


def test_session_and_refresh_use_different_salts():
    """A session token must not decode under the refresh salt — otherwise a
    session token leak would be functionally equivalent to a 90-day refresh."""
    session = make_boater_session_token('bob@example.com')
    with pytest.raises(signing.BadSignature):
        decode_boater_refresh_token(session)


def test_tampered_token_rejected():
    token = make_boater_session_token('bob@example.com')
    tampered = token[:-2] + ('AA' if not token.endswith('AA') else 'BB')
    with pytest.raises(signing.BadSignature):
        decode_boater_session_token(tampered)


def test_boater_user_normalises_email():
    user = BoaterUser('  Bob@Example.COM  ')
    assert user.email == 'bob@example.com'
    assert user.is_authenticated
    assert user.is_boater
    assert user.role == 'boater'
    assert user.pk == 'bob@example.com'
