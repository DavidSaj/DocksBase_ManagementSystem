"""Boater-scoped session tokens.

A boater is one identity (email). One token authorises them at *every* marina
they have a record at. Per-marina authorisation is dynamic — see
`resolve_marina_for_boater` — not encoded in the token.

Replaces the marina-scoped guest / member tokens in `checkin_utils.py` and
`member_auth_utils.py` during a deprecation window; both shapes are accepted
by the auth layer until the legacy decoders are removed.
"""
from django.core import signing

BOATER_SESSION_SALT = 'portal-boater-v1'
BOATER_REFRESH_SALT = 'portal-boater-refresh-v1'

BOATER_SESSION_MAX_AGE = 60 * 60             # 1 hour
BOATER_REFRESH_MAX_AGE = 60 * 60 * 24 * 90   # 90 days


def make_boater_session_token(email):
    return signing.dumps(
        {'email': email, 'type': 'boater'},
        salt=BOATER_SESSION_SALT,
    )


def decode_boater_session_token(token):
    return signing.loads(token, salt=BOATER_SESSION_SALT, max_age=BOATER_SESSION_MAX_AGE)


def make_boater_refresh_token(email):
    return signing.dumps(
        {'email': email, 'type': 'boater'},
        salt=BOATER_REFRESH_SALT,
    )


def decode_boater_refresh_token(token):
    return signing.loads(token, salt=BOATER_REFRESH_SALT, max_age=BOATER_REFRESH_MAX_AGE)


class BoaterUser:
    """Authenticated boater identity with no marina context.

    Marina permission is resolved per-request via `resolve_marina_for_boater`
    using `X-Marina-Slug`. The token carries no marina claim.
    """
    is_authenticated = True
    is_anonymous = False
    is_boater = True
    role = 'boater'  # satisfies ModulePermission early-return for boaters

    def __init__(self, email):
        self.email = (email or '').strip().lower()
        self.pk = self.email  # required by DRF throttling

    def __repr__(self):
        return f'BoaterUser({self.email!r})'
